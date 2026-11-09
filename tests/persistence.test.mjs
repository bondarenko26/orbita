import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('empty installation and data survive a real server restart',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'orbita-empty-'));let child;
 const start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DEMO_SEED:'0',DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>{output+=d;const m=output.match(/Орбита: (http:\/\/127.0.0.1:\d+)/);if(m)resolve({url:m[1],password:output.match(/admin \/ (\S+)/)?.[1]})});child.on('error',reject);child.on('exit',c=>{if(c)reject(Error('Server exited'))})});
 const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill()});
 try{
 let instance=await start();const request=async(p,b,cookie)=>{const r=await fetch(instance.url+'/api/'+p,{method:b?'POST':'GET',headers:{...(b?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 const auth=await request('login',{login:'admin',password:instance.password});assert.equal(auth.status,200);
 const state=await request('manage',null,auth.cookie);assert.equal(state.body.entities.users.rows.length,1);assert.equal(state.body.entities.lessons.rows.length,0);
 const created=await request('manage/groups',{name:'ТЕСТ-101',program_id:state.body.catalog.find(n=>n.kind==='program').id,course:1,admission_year:2026},auth.cookie);assert.equal(created.status,200,JSON.stringify(created.body));
 await stop();instance=await start();assert.equal(instance.password,undefined);
 const restored=await request('manage',null,auth.cookie);assert.equal(restored.status,200);assert.equal(restored.body.groups[0].name,'ТЕСТ-101');assert.equal(restored.body.audit.length,1);
 }finally{if(child&&child.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true})}
});
