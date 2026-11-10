import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {fakeSMTP} from './helpers.mjs';
import {passwordError,temporaryPassword} from '../credentials.mjs';
test('email onboarding, password rules, scoped deletion and restoration',async t=>{
 const smtp=await fakeSMTP(),dir=mkdtempSync(path.join(os.tmpdir(),'orbita-v05-'));let child;
 t.after(async()=>{if(child?.exitCode===null){const p=new Promise(r=>child.once('exit',r));child.kill();await p}await smtp.close();rmSync(dir,{recursive:true,force:true})});
 const start=()=>new Promise((resolve,reject)=>{let out='',err='';child=spawn(process.execPath,['server.mjs'],{env:{...process.env,...smtp.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>{out+=d;const m=out.match(/Орбита: (http:\/\/127.0.0.1:\d+)/);if(m)resolve({url:m[1],password:out.match(/admin \/ (\S+)/)?.[1]})});child.stderr.on('data',d=>err+=d);child.on('exit',()=>reject(Error(err)));child.on('error',reject)});
 let {url,password}=await start();
 const req=async(p,b,c)=>{const r=await fetch(url+'/api/'+p,{method:b===undefined?'GET':'POST',headers:{...(b===undefined?{}:{'Content-Type':'application/json'}),...(c?{cookie:c}:{})},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 const ok=async(p,b,c)=>{const r=await req(p,b,c);assert.ok([200,201].includes(r.status),p+': '+JSON.stringify(r.body));return r.body};
 const admin=await req('login',{login:'admin',password});let ac=admin.cookie;
 const m=await ok('manage',undefined,ac),nodes=m.catalog;const institute=n=>{while(n.parent_id)n=nodes.find(p=>p.id===n.parent_id);return n.id};
 const prog=nodes.find(n=>n.kind==='program'),inst=institute(prog),otherProg=nodes.find(n=>n.kind==='program'&&institute(n)!==inst);
 const g=await ok('manage/groups',{name:'ТЕСТ-EMAIL',program_id:prog.id,course:1,admission_year:2026},ac),g2=await ok('manage/groups',{name:'ЧУЖАЯ',program_id:otherProg.id,course:1,admission_year:2026},ac);
 const file=async rows=>{const w=new ExcelJS.Workbook(),s=w.addWorksheet('Аккаунты');s.addRow(['ФИО','Роль','Группа','Подгруппа','Институт','Email']);rows.forEach(r=>s.addRow(r));return {file_name:'test.xlsx',file:Buffer.from(await w.xlsx.writeBuffer()).toString('base64')}};
 let student,teacher,sc,tc,staff,dc,assignment,lesson,grade;
 await t.test('password policy exactly matches requested limits',()=>{
  for(const p of ['Abc12345','abc1234!','Abcdefghijklmn','abcde!12'])assert.equal(passwordError(p),null,p);
  for(const p of ['Abc1234','Abcdefghijklmno','abc12345','AB12345!','абв1234!','Abc 123!'])assert.ok(passwordError(p),p);
  for(let i=0;i<50;i++)assert.equal(passwordError(temporaryPassword()),null);
 });
 await t.test('XLSX email column, preview validation and atomic queue',async()=>{
  const response=await fetch(url+'/api/accounts/template',{headers:{cookie:ac}});assert.equal(response.status,200);const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await response.arrayBuffer()));assert.equal(w.getWorksheet('Аккаунты').getCell('F1').value,'Email');
  const bad=await ok('accounts/preview',await file([['Тест','Студент','ТЕСТ-EMAIL','','','invalid'],['Тест','Студент','Нет','','','ok@example.test']]),ac);assert.equal(bad.valid,false);assert.equal((await ok('manage',undefined,ac)).entities.users.rows.length,1);
  const rows=[['Студент Пример','Студент','ТЕСТ-EMAIL','','','Student@Example.test'],['Преподаватель Пример','Преподаватель','','',inst,'teacher@example.test']];
  const preview=await ok('accounts/preview',await file(rows),ac);assert.equal(preview.valid,true);assert.equal(preview.rows[0].login,'student@example.test');
  const result=await ok('accounts/commit',{token:preview.token},ac);assert.equal(result.count,2);assert.equal(result.credentials,undefined);assert.equal((await req('accounts/commit',{token:preview.token},ac)).status,409);
  assert.equal((await ok('accounts/preview',await file(rows),ac)).valid,false);
  const message=await smtp.wait('student@example.test');const temporary=message.text.match(/Временный пароль: (\S+)/)?.[1];assert.ok(temporary,message.text);assert.equal(passwordError(temporary),null);
  const auth=await req('login',{login:'STUDENT@EXAMPLE.TEST',password:temporary});assert.equal(auth.status,200);student=auth.body;
  assert.equal((await req('grades',undefined,auth.cookie)).status,403);assert.equal((await req('password',{current_password:temporary,new_password:'abc12345',confirm_password:'abc12345'},auth.cookie)).status,400);
  const changed=await req('password',{current_password:temporary,new_password:'Student!12',confirm_password:'Student!12'},auth.cookie);assert.equal(changed.status,200);sc=changed.cookie;assert.equal((await req('me',undefined,auth.cookie)).status,401);
  const tm=await smtp.wait('teacher@example.test'),tp=tm.text.match(/Временный пароль: (\S+)/)[1];let ta=await req('login',{login:'teacher@example.test',password:tp});teacher=ta.body;ta=await req('password',{current_password:tp,new_password:'Teacher!12',confirm_password:'Teacher!12'},ta.cookie);tc=ta.cookie;
  const db=new DatabaseSync(path.join(dir,'orbita.sqlite'),{readOnly:true});assert.ok(!JSON.stringify(db.prepare('SELECT * FROM users').all()).includes(temporary));assert.ok(!JSON.stringify(db.prepare('SELECT * FROM mail_jobs').all()).includes(temporary));db.close();
 });
 await t.test('only staff can change login; scope and session revocation enforced',async()=>{
  const s=await ok('manage/users',{name:'Декан Тестовый',login:'dean@example.test',password:'DeanTest!12',role:'staff',active:1},ac);staff=s;
  let auth=await req('login',{login:'dean@example.test',password:'DeanTest!12'});auth=await req('password',{current_password:'DeanTest!12',new_password:'DeanNew!123',confirm_password:'DeanNew!123'},auth.cookie);dc=auth.cookie;
  await ok('manage/staff_scopes',{user_id:s.id,institute_id:inst,active:1},ac);
  assert.equal((await req('email/request',{email:'own@example.test',current_password:'Student!12'},sc)).status,403);
  assert.equal((await req('accounts/email',{id:teacher.id,email:'other@example.test',current_password:'Student!12'},sc)).status,403);
  const foreign=await ok('manage/users',{name:'Другой студент',login:'foreign@example.test',password:'ForeignA!12',role:'student',group_id:g2.id,active:1},ac);
  assert.equal((await req('accounts/email',{id:foreign.id,email:'no@example.test',current_password:'DeanNew!123'},dc)).status,404);
  assert.equal((await req('accounts/email',{id:student.id,email:'teacher@example.test',current_password:'DeanNew!123'},dc)).status,409);
  const before=smtp.messages.length;await ok('accounts/email',{id:student.id,email:'new-student@example.test',current_password:'DeanNew!123'},dc);assert.equal((await req('me',undefined,sc)).status,401);assert.equal((await req('login',{login:'student@example.test',password:'Student!12'})).status,401);
  const email=await smtp.wait('new-student@example.test',before),temp=email.text.match(/Временный пароль: (\S+)/)[1];let session=await req('login',{login:'new-student@example.test',password:temp});session=await req('password',{current_password:temp,new_password:'Student!12',confirm_password:'Student!12'},session.cookie);sc=session.cookie;
 });
 await t.test('deletion of grades and lessons is scoped, reversible and logged',async()=>{
  assignment=await ok('manage/teaching_assignments',{teacher_id:teacher.id,group_id:g.id,subgroup:'',subject:'Тестовый предмет',semester:'Тест',start_date:'2026-09-01',end_date:'2027-01-31',active:1},ac);
  lesson=await ok('manage/lessons',{assignment_id:assignment.id,kind:'Лекция',day:1,start:'09:00',end:'10:20',room:'Тест',parity:'all',term_start:'2026-09-01',term_end:'2027-01-31',archived:0},ac);
  grade=await ok('teaching/grade',{assignment_id:assignment.id,user_id:student.id,date:'2026-11-09',score:'5',assessment:'Контрольная'},tc);
  assert.equal((await req('records/grades/delete',{id:grade.id},sc)).status,404);
  await ok('records/grades/delete',{id:grade.id},tc);assert.equal((await ok('grades',undefined,sc)).length,0);assert.ok((await ok('trash',undefined,tc)).some(r=>r.id===grade.id&&r.table==='grades'));
  assert.equal((await req('teaching/grade',{id:grade.id,assignment_id:assignment.id,user_id:student.id,date:'2026-11-09',score:'4',assessment:'Контрольная'},tc)).status,404);
  await ok('records/grades/restore',{id:grade.id},tc);assert.equal((await ok('grades',undefined,sc)).length,1);
  const j=await ok('teaching/journal?assignment='+assignment.id+'&date=2026-11-09',undefined,tc);assert.ok(j.history.some(h=>JSON.parse(h.new_json).deleted_at));
  await ok('records/lessons/delete',{id:lesson.id},dc);assert.equal((await ok('schedule?date=2026-11-09',undefined,sc)).lessons.length,0);await ok('records/lessons/restore',{id:lesson.id},dc);assert.equal((await ok('schedule?date=2026-11-09',undefined,sc)).lessons.length,1);
 });
 await t.test('group and teacher dependency checks; account deletion invalidates sessions',async()=>{
  assert.equal((await req('records/groups/delete',{id:g.id},ac)).status,409);assert.equal((await req('records/users/delete',{id:teacher.id},ac)).status,409);assert.equal((await req('records/users/delete',{id:admin.body.id},ac)).status,409);
  await ok('records/users/delete',{id:student.id},dc);assert.equal((await req('me',undefined,sc)).status,401);assert.equal((await req('login',{login:'new-student@example.test',password:'Student!12'})).status,401);
  await ok('records/users/restore',{id:student.id},dc);sc=(await req('login',{login:'new-student@example.test',password:'Student!12'})).cookie;assert.equal((await ok('grades',undefined,sc)).length,1);
  const empty=await ok('manage/groups',{name:'ПУСТАЯ',program_id:prog.id,course:1,admission_year:2026},ac);await ok('records/groups/delete',{id:empty.id},dc);assert.ok(!(await ok('manage',undefined,ac)).groups.some(g=>g.id===empty.id));await ok('records/groups/restore',{id:empty.id},dc);
  await ok('manage/teaching_assignments',{id:assignment.id,teacher_id:teacher.id,group_id:g.id,subgroup:'',subject:'Тестовый предмет',semester:'Тест',start_date:'2026-09-01',end_date:'2027-01-31',active:0},ac);await ok('records/users/delete',{id:teacher.id},dc);assert.equal((await req('me',undefined,tc)).status,401);await ok('records/users/restore',{id:teacher.id},dc);
 });
 await t.test('clubs, teams and competitions can be deleted and restored',async()=>{
  const club=await ok('manage/clubs',{title:'Тестовая секция',category:'Спорт',description:'Тест',place:'Тест',weekday:1,start:'18:00',end:'19:00',capacity:10,owner:admin.body.id,enrollment_open:1,archived:0},ac);
  assert.equal((await req('records/clubs/delete',{id:club.id},dc)).status,404);await ok('records/clubs/delete',{id:club.id},ac);assert.equal((await ok('clubs',undefined,sc)).length,0);await ok('records/clubs/restore',{id:club.id},ac);
  for(const type of ['Сборная','Соревнование']){const event=await ok('manage/events',{title:type+' Тест',type,date:'2026-11-20T12:00',place:'Тест',description:'Тест',owner:admin.body.id,archived:0},ac);await ok('records/events/delete',{id:event.id},ac);assert.ok(!(await ok('events',undefined,sc)).some(e=>e.id===event.id));await ok('records/events/restore',{id:event.id},ac)}
 });
 await t.test('admin self email change requires confirmation and survives restart',async()=>{
  const before=smtp.messages.length;await ok('email/request',{email:'admin-new@example.test',current_password:password},ac);const email=await smtp.wait('admin-new@example.test',before),code=email.text.match(/Код подтверждения: (\d{6})/)[1];assert.equal((await req('email/confirm',{code:'000000'},ac)).status,400);const result=await req('email/confirm',{code},ac);assert.equal(result.status,200);ac=result.cookie;assert.equal((await ok('me',undefined,ac)).login,'admin-new@example.test');
  const end=new Promise(r=>child.once('exit',r));child.kill();await end;url=(await start()).url;assert.equal((await ok('me',undefined,ac)).login,'admin-new@example.test');const state=await ok('mail/status',undefined,ac);assert.ok(state.configured);assert.ok(state.jobs.some(j=>j.state==='sent'));assert.ok(!JSON.stringify(state).includes('payload'));
 });
});
