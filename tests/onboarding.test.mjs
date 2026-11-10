import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

test('Excel onboarding and password lifecycle',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'orbita-onboarding-'));
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});let out='',errors='';child.stderr.on('data',d=>errors+=d);
 t.after(async()=>{if(child.exitCode===null){const end=new Promise(r=>child.once('exit',r));child.kill();await end}rmSync(dir,{recursive:true,force:true})});
 const {url,password}=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;const m=out.match(/Орбита: (http:\/\/127.0.0.1:\d+)/);if(m)resolve({url:m[1],password:out.match(/admin \/ (\S+)/)[1]})});child.on('error',reject);child.on('exit',()=>reject(Error(errors)))});
 const req=async(p,b,c)=>{const r=await fetch(url+'/api/'+p,{method:b===undefined?'GET':'POST',headers:{...(b===undefined?{}:{'Content-Type':'application/json'}),...(c?{cookie:c}:{})},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 const ok=async(p,b,c)=>{const r=await req(p,b,c);assert.ok([200,201].includes(r.status),p+': '+JSON.stringify(r.body));return r.body};
 const auth=await req('login',{login:'admin',password});let ac=auth.cookie;
 const state=await ok('manage',undefined,ac),nodes=state.catalog;const inst=n=>{while(n.parent_id)n=nodes.find(p=>p.id===n.parent_id);return n.id};
 const program=nodes.find(n=>n.kind==='program'),institute=inst(program),otherProgram=nodes.find(n=>n.kind==='program'&&inst(n)!==institute);
 const group=await ok('manage/groups',{name:'ИМПОРТ-ТЕСТ',program_id:program.id,course:1,admission_year:2026},ac);
 const other=await ok('manage/groups',{name:'ДРУГОЙ-ТЕСТ',program_id:otherProgram.id,course:1,admission_year:2026},ac);
 async function file(rows){const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Аккаунты');s.addRow(['ФИО','Роль','Группа','Подгруппа','Институт']);rows.forEach(r=>s.addRow(r));return {file_name:'accounts.xlsx',file:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')}}
 const rows=[['Вымышленный Студент','Студент','ИМПОРТ-ТЕСТ','А',''],['Вымышленный Преподаватель','Преподаватель','','',institute]];
 const upload=await file(rows);let preview,result,student,teacher,sc,tc;
 await t.test('scoped template round trip and preview does not create users',async()=>{
  const r=await fetch(url+'/api/accounts/template',{headers:{cookie:ac}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));assert.equal(wb.getWorksheet('Аккаунты').getCell('A1').value,'ФИО');assert.equal(wb.getWorksheet('Группы').getCell('A2').value,'ИМПОРТ-ТЕСТ');
  wb.getWorksheet('Аккаунты').getRow(2).values=rows[0];const roundtrip=await ok('accounts/preview',{file_name:'template.xlsx',file:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')},ac);assert.equal(roundtrip.valid,true);assert.equal(roundtrip.count,1);
  preview=await ok('accounts/preview',upload,ac);assert.equal(preview.valid,true);assert.equal(preview.count,2);assert.equal(new Set(preview.rows.map(r=>r.login)).size,2);assert.equal((await ok('manage',undefined,ac)).entities.users.rows.length,1);assert.equal(JSON.stringify(preview).includes('password'),false);
 });
 await t.test('rejects invalid files, formulas, duplicate rows and invalid groups',async()=>{
  assert.equal((await req('accounts/preview',{file_name:'x.xlsx',file:'bm90LXhsc3g='},ac)).status,400);
  assert.equal((await req('accounts/preview',await file([[{formula:'1+1'},'Студент','ИМПОРТ-ТЕСТ','','']]),ac)).status,400);
  const invalid=await ok('accounts/preview',await file([rows[0],rows[0],['Имя','Админ','','',''],['Имя','Студент','Нет группы','','']]),ac);assert.equal(invalid.valid,false);assert.equal(invalid.token,null);assert.ok(invalid.rows[1].errors.length);assert.ok(invalid.rows[2].errors.length);assert.ok(invalid.rows[3].errors.length);
  assert.equal((await req('accounts/preview',await file(Array.from({length:201},()=>rows[0])),ac)).status,400);
  assert.equal((await ok('manage',undefined,ac)).entities.users.rows.length,1);
  preview=await ok('accounts/preview',upload,ac);
 });
 await t.test('atomic creation, one-time credential delivery, no plaintext persistence and duplicate prevention',async()=>{
  result=await ok('accounts/commit',{token:preview.token},ac);assert.equal(result.count,2);[student,teacher]=result.credentials;
  assert.equal(student.login,preview.rows[0].login);assert.ok(student.password.length>=12);assert.notEqual(student.password,teacher.password);
  assert.equal((await req('accounts/commit',{token:preview.token},ac)).status,409);
  const again=await ok('accounts/preview',upload,ac);assert.equal(again.valid,false);assert.ok(again.rows.every(r=>r.errors.length));
  const db=new DatabaseSync(path.join(dir,'orbita.sqlite'),{readOnly:true});const accounts=db.prepare('SELECT * FROM users').all();assert.equal(accounts.length,3);assert.equal(accounts.find(u=>u.id===student.id).must_change_password,1);assert.ok(!JSON.stringify(accounts).includes(student.password));assert.ok(!JSON.stringify(db.prepare('SELECT * FROM audit').all()).includes(student.password));db.close();assert.ok(!out.includes(student.password)&&!errors.includes(student.password));
 });
 await t.test('Excel delivery preserves exact text and is limited to authorized recipients',async()=>{
  const r=await fetch(url+'/api/accounts/export',{method:'POST',headers:{cookie:ac,'Content-Type':'application/json'},body:JSON.stringify({credentials:result.credentials.map(r=>({id:r.id,password:r.password}))})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));assert.equal(wb.getWorksheet('Доступ').getCell('C2').value,student.password);assert.equal(wb.getWorksheet('Доступ').getCell('C3').value,teacher.password);assert.equal(wb.getWorksheet('Доступ').getCell('F2').value,url);
  const wrong=await req('accounts/export',{credentials:[{id:student.id,password:'wrong'}]},ac);assert.equal(wrong.status,400);
 });
 await t.test('temporary sessions cannot access any study data or administrative actions',async()=>{
  const s=await req('login',{login:student.login,password:student.password});assert.equal(s.status,200);sc=s.cookie;assert.equal(s.body.must_change_password,1);assert.equal(s.body.education,undefined);
  const te=await req('login',{login:teacher.login,password:teacher.password});tc=te.cookie;
  for(const p of ['schedule?date=2026-11-09','grades','requests','manage','teaching','attendance','notices','accounts/template'])assert.equal((await req(p,undefined,sc)).status,403,p);
  assert.equal((await req('theme',{theme:'light'},sc)).status,403);assert.equal((await req('accounts/preview',upload,sc)).status,403);assert.equal((await req('accounts/export',{credentials:[student]},sc)).status,403);assert.equal((await req('teaching',undefined,tc)).status,403);
  assert.equal((await ok('me',undefined,sc)).must_change_password,1);
 });
 await t.test('mandatory password change, validation and revocation of other sessions',async()=>{
  const second=await req('login',{login:student.login,password:student.password});
  assert.equal((await req('password',{current_password:'wrong',new_password:'New-Password-2026!',confirm_password:'New-Password-2026!'},sc)).status,400);
  assert.equal((await req('password',{current_password:student.password,new_password:student.password,confirm_password:student.password},sc)).status,400);
  assert.equal((await req('password',{current_password:student.password,new_password:'New-Password-2026!',confirm_password:'mismatch'},sc)).status,400);
  const changed=await req('password',{current_password:student.password,new_password:'New-Password-2026!',confirm_password:'New-Password-2026!'},sc);assert.equal(changed.status,200);assert.equal(changed.body.must_change_password,0);assert.ok(changed.cookie);const old=sc;sc=changed.cookie;
  assert.equal((await req('me',undefined,old)).status,401);assert.equal((await req('me',undefined,second.cookie)).status,401);assert.equal((await req('login',{login:student.login,password:student.password})).status,401);
  assert.equal((await ok('me',undefined,sc)).grp,'ИМПОРТ-ТЕСТ');assert.equal((await req('schedule?date=2026-11-09',undefined,sc)).status,200);assert.equal((await req('accounts/preview',upload,sc)).status,403);
  const changedTeacher=await req('password',{current_password:teacher.password,new_password:'Teacher-Password-2026!',confirm_password:'Teacher-Password-2026!'},tc);assert.equal(changedTeacher.status,200);tc=changedTeacher.cookie;assert.equal((await req('teaching',undefined,tc)).status,200);
 });
 await t.test('manual generation, profile changes, temporary expiry and administrator reset',async()=>{
  const made=await ok('manage/users',{name:'Ручной Тестовый',role:'student',group_id:group.id,active:1},ac);assert.ok(made.credentials[0].login.startsWith('s-'));assert.equal(made.credentials.length,1);
  const db=new DatabaseSync(path.join(dir,'orbita.sqlite'));db.prepare('UPDATE users SET temporary_password_expires=? WHERE id=?').run(Date.now()-1000,made.id);db.close();
  const credential=made.credentials[0];assert.equal((await req('login',{login:credential.login,password:credential.password})).status,403);
  assert.equal((await req('accounts/reset',{id:teacher.id},sc)).status,403);assert.equal((await req('accounts/reset',{id:auth.body.id},ac)).status,400);
  const reset=await ok('accounts/reset',{id:student.id},ac);assert.notEqual(reset.credentials[0].password,student.password);assert.equal((await req('me',undefined,sc)).status,401);
  const login=await req('login',{login:student.login,password:reset.credentials[0].password});assert.equal(login.body.must_change_password,1);
  const change=await req('password',{current_password:password,new_password:'Admin-Changed-2026!',confirm_password:'Admin-Changed-2026!'},ac);assert.equal(change.status,200);ac=change.cookie;assert.equal((await req('me',undefined,auth.cookie)).status,401);
 });
 await t.test('password guessing is limited and reset restores recovery',async()=>{
  const data={current_password:'wrong',new_password:'Recovery-Password-2026!',confirm_password:'Recovery-Password-2026!'};
  for(let i=0;i<5;i++)assert.equal((await req('password',data,tc)).status,400);
  assert.equal((await req('password',{...data,current_password:'Teacher-Password-2026!'},tc)).status,429);
  const reset=await ok('accounts/reset',{id:teacher.id},ac),temp=reset.credentials[0];let s=await req('login',{login:temp.login,password:temp.password});s=await req('password',{...data,current_password:temp.password},s.cookie);assert.equal(s.status,200);
 });
 await t.test('dean scope, session-bound confirmation and revoked access',async()=>{
  const staff=await ok('manage/users',{name:'Тестовый Деканат',role:'staff',active:1},ac),cred=staff.credentials[0];let s=await req('login',{login:cred.login,password:cred.password});s=await req('password',{current_password:cred.password,new_password:'Staff-Changed-2026!',confirm_password:'Staff-Changed-2026!'},s.cookie);const cookie=s.cookie;
  const scope={user_id:staff.id,institute_id:institute,active:1},id=(await ok('manage/staff_scopes',scope,ac)).id;
  const restricted=await ok('accounts/preview',await file([['Недоступный Студент','Студент','ДРУГОЙ-ТЕСТ','','']]),cookie);assert.equal(restricted.valid,false);
  const p=await ok('accounts/preview',await file([['Новый Тестовый','Студент','ИМПОРТ-ТЕСТ','','']]),cookie);assert.equal(p.valid,true);
  assert.equal((await req('accounts/commit',{token:p.token},ac)).status,409);
  await ok('manage/staff_scopes',{...scope,id,active:0},ac);assert.equal((await req('accounts/commit',{token:p.token},cookie)).status,409);assert.equal((await req('accounts/reset',{id:student.id},cookie)).status,404);
 });
 assert.ok(!errors.includes('Error:'),errors);
});
