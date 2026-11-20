import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
test('empty installation and data survive a real server restart',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'orbita-empty-'));let child;
 const start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,SMTP_HOST:'',DEMO_SEED:'0',DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>{output+=d;const m=output.match(/Орбита: (http:\/\/127.0.0.1:\d+)/);if(m)resolve({url:m[1],password:output.match(/admin \/ (\S+)/)?.[1]})});child.on('error',reject);child.on('exit',c=>{if(c)reject(Error('Server exited'))})});
 const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill()});
 try{
 let instance=await start();const request=async(p,b,cookie)=>{const r=await fetch(instance.url+'/api/'+p,{method:b?'POST':'GET',headers:{...(b?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 const auth=await request('login',{login:'admin',password:instance.password});assert.equal(auth.status,200);
 const state=await request('manage',null,auth.cookie);assert.equal(state.body.entities.users.rows.length,1);assert.equal(state.body.entities.lessons.rows.length,0);
 const created=await request('manage/groups',{name:'ТЕСТ-101',program_id:state.body.catalog.find(n=>n.kind==='program').id,course:1,admission_year:2026},auth.cookie);assert.equal(created.status,200,JSON.stringify(created.body));
 const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Аккаунты');sheet.addRow(['ФИО','Роль','Группа','Подгруппа','Институт','Email']);sheet.addRow(['Студент Тестовый','Студент','ТЕСТ-101','','','test@example.test']);
 const preview=await request('accounts/preview',{file_name:'test.xlsx',file:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')},auth.cookie);assert.equal(preview.body.valid,true);
 assert.equal((await request('accounts/commit',{token:preview.body.token},auth.cookie)).status,503);
 assert.equal((await request('manage',null,auth.cookie)).body.entities.users.rows.length,1);
 await stop();instance=await start();assert.equal(instance.password,undefined);
 const restored=await request('manage',null,auth.cookie);assert.equal(restored.status,200);assert.equal(restored.body.groups[0].name,'ТЕСТ-101');assert.equal(restored.body.audit.length,1);

 const createGroup=(name)=>request('manage/groups',{name,program_id:state.body.catalog.find(n=>n.kind==='program').id,course:1,admission_year:2026},auth.cookie);
 const recent=await createGroup('ТЕСТ-КОРЗИНА');
 assert.equal(recent.status,200);
 assert.equal((await request('records/groups/delete',{id:recent.body.id},auth.cookie)).status,200);
 {
  const db=new DatabaseSync(path.join(dir,'orbita.sqlite'));
  try {
   db.exec(`INSERT INTO users(login,password,name,role,deleted_at)
     VALUES('expired@example.test','unused','Пробный','student',datetime('now','-31 days'));
    INSERT INTO grades(user_id,subject) SELECT id,'Пробный предмет' FROM users WHERE login='expired@example.test';
    UPDATE groups SET deleted_at=datetime('now','-31 days') WHERE name='ТЕСТ-101';`);
  } finally { db.close(); }
 }
 assert.equal((await request('records/groups/restore',{id:created.body.id},auth.cookie)).status,410);
 const trash=await request('trash',null,auth.cookie);
 assert.deepEqual(trash.body.map(row=>row.id),[recent.body.id]);
 assert.equal(Date.parse(trash.body[0].expires_at)-Date.parse(trash.body[0].date),30*86400000);
 await stop();
 instance=await start();
 const db=new DatabaseSync(path.join(dir,'orbita.sqlite'),{readOnly:true});
 try {
  assert.equal(db.prepare("SELECT count(*) n FROM users WHERE login='expired@example.test'").get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM grades').get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM groups WHERE name='ТЕСТ-101'").get().n,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally { db.close(); }
 assert.equal((await request('records/groups/restore',{id:recent.body.id},auth.cookie)).status,200);
 }finally{if(child&&child.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true})}
});
