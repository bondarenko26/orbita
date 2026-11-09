import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
// Fixtures are created via the real API in a disposable database only.
test('MGSU permissions and complete academic workflows',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'orbita-security-'));
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});
 let out='',errors='';child.stderr.on('data',d=>errors+=d);
 t.after(async()=>{if(child.exitCode===null){const end=new Promise(r=>child.once('exit',r));child.kill();await end}rmSync(dir,{recursive:true,force:true})});
 const {url,password}=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;const m=out.match(/Орбита: (http:\/\/127.0.0.1:\d+)/);if(m)resolve({url:m[1],password:out.match(/admin \/ (\S+)/)[1]})});child.on('error',reject);child.on('exit',()=>reject(Error(errors)))});
 async function req(p,b,c){const r=await fetch(url+'/api/'+p,{method:b===undefined?'GET':'POST',headers:{...(b===undefined?{}:{'Content-Type':'application/json'}),...(c?{cookie:c}:{})},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers}}
 async function ok(p,b,c){const r=await req(p,b,c);assert.ok([200,201].includes(r.status),p+': '+r.status+' '+JSON.stringify(r.body));return r.body}
 const admin=await req('login',{login:'admin',password}),ac=admin.cookie;
 const initial=await ok('manage',undefined,ac),nodes=initial.catalog;
 await t.test('no demo records, safe passwords and sessions',async()=>{
  assert.equal((await req('me')).status,401);assert.equal(admin.body.password,undefined);assert.match(admin.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal(initial.entities.users.rows.length,1);for(const e of ['groups','lessons','grades','clubs','events','teaching_assignments','staff_scopes'])assert.equal(initial.entities[e].rows.length,0,e);
  assert.equal(nodes.filter(n=>n.kind==='program').length,76);
  const db=new DatabaseSync(path.join(dir,'orbita.sqlite'),{readOnly:true});assert.match(db.prepare('SELECT password FROM users').get().password,/^[a-f0-9]{32}:[a-f0-9]{128}$/);db.close();
  assert.equal((await req('login',{login:'admin',password:'wrong'})).status,401);
 });
 const institute=n=>{while(n.parent_id)n=nodes.find(x=>x.id===n.parent_id);return n.id};
 const p1=nodes.find(n=>n.kind==='program'),i1=institute(p1),p2=nodes.find(n=>n.kind==='program'&&institute(n)!==i1),i2=institute(p2);
 const g1=await ok('manage/groups',{name:'ТЕСТ-А',program_id:p1.id,course:1,admission_year:2026},ac),g2=await ok('manage/groups',{name:'ТЕСТ-Б',program_id:p2.id,course:1,admission_year:2026},ac);
 const profiles=new Map();
 async function account(login,role,group_id=null,institute_id=null,subgroup='',who=ac){const profile={login,name:'Вымышленный '+login,password:'Isolated-Password-2026',role,group_id,institute_id,subgroup,active:1};const made=await ok('manage/users',profile,who);profiles.set(login,{...profile,id:made.id});const r=await req('login',{login,password:profile.password});assert.equal(r.status,200);return r}
 const staff=await account('dean-a','staff'),staff2=await account('dean-b','staff');
 const scope={user_id:staff.body.id,institute_id:i1,active:1},scopeId=await ok('manage/staff_scopes',scope,ac);
 await ok('manage/staff_scopes',{user_id:staff2.body.id,institute_id:i2,active:1},ac);
 const a=await account('student-a','student',g1.id,null,'A',staff.cookie),b=await account('student-b','student',g2.id),c=await account('student-c','student',g1.id,null,'B',staff.cookie);
 const teacher=await account('teacher-a','teacher',null,i1,'',staff.cookie),teacher2=await account('teacher-b','teacher',null,i2),coach=await account('coach-a','manager'),coach2=await account('coach-b','manager');
 const term={start_date:'2026-09-01',end_date:'2027-01-31',semester:'2026/27 · 1 семестр',active:1};
 const asData={...term,teacher_id:teacher.body.id,group_id:g1.id,subgroup:'A',subject:'Тестовая дисциплина А'};
 const as1=await ok('manage/teaching_assignments',asData,staff.cookie),as2=await ok('manage/teaching_assignments',{...term,teacher_id:teacher2.body.id,group_id:g2.id,subgroup:'',subject:'Тестовая дисциплина Б'},ac);
 await ok('manage/settings',{id:1,semester_start:'2026-09-01',semester_end:'2027-01-31',week_anchor:'2026-08-31'},ac);
 const lesson={assignment_id:as1.id,kind:'Лекция',day:1,start:'09:00',end:'10:20',room:'Тест-101',parity:'all',date:null,term_start:term.start_date,term_end:term.end_date,archived:0};
 const l1=await ok('manage/lessons',lesson,staff.cookie),l2=await ok('manage/lessons',{...lesson,assignment_id:as2.id},ac);
 const journal=who=>ok('teaching/journal?assignment='+as1.id+'&date=2026-11-09',undefined,who);
 await t.test('dean scopes and fixed student profiles',async()=>{
  const s=await ok('manage',undefined,staff.cookie);assert.deepEqual(s.groups.map(g=>g.id),[g1.id]);assert.ok(!JSON.stringify(s).includes('student-b'));assert.equal(s.entities.users.fields.find(f=>f.name==='role').options.length,2);
  assert.equal((await req('manage/users',{...profiles.get('student-b'),name:'Changed'},staff.cookie)).status,404);
  assert.equal((await req('manage/users',{...profiles.get('student-a'),role:'admin'},staff.cookie)).status,403);
  assert.equal((await req('manage/users',{...profiles.get('student-a'),group_id:g2.id},staff.cookie)).status,403);
  assert.equal((await req('manage/teaching_assignments',{...asData,group_id:g2.id},staff.cookie)).status,403);
  assert.equal((await req('manage/staff_scopes',scope,staff.cookie)).status,403);
  for(const cookie of [a.cookie,b.cookie,teacher.cookie])assert.equal((await req('manage',undefined,cookie)).status,403);
  assert.equal((await req('manage/users',{...profiles.get('student-a'),group_id:g2.id},a.cookie)).status,403);
  const me=await ok('me',undefined,a.cookie);assert.equal(me.grp,'ТЕСТ-А');assert.equal(me.education.length,5);
  assert.equal((await ok('manage',undefined,coach.cookie)).teachers.length,0);
 });
 await t.test('schedule and personal notes respect subgroups',async()=>{
  assert.equal((await ok('schedule?date=2026-11-09',undefined,a.cookie)).lessons[0].id,l1.id);
  assert.equal((await ok('schedule?date=2026-11-09',undefined,c.cookie)).lessons.length,0);
  for(const [cookie,id]of [[c.cookie,l1.id],[a.cookie,l2.id]])assert.equal((await req('notes',{lesson_id:id,date:'2026-11-09',text:'forged'},cookie)).status,404);
  await ok('notes',{lesson_id:l1.id,date:'2026-11-09',text:'Личная заметка'},a.cookie);
  assert.equal((await ok('schedule?date=2026-11-09',undefined,a.cookie)).lessons[0].note,'Личная заметка');
  const ts=await ok('schedule?date=2026-11-09',undefined,teacher.cookie);assert.equal(ts.lessons[0].group_name,'ТЕСТ-А');assert.equal(ts.lessons[0].note,null);
 });
 const grade={assignment_id:as1.id,user_id:a.body.id,date:'2026-11-09',score:'4',assessment:'Контрольная'},mark={assignment_id:as1.id,user_id:a.body.id,lesson_id:l1.id,date:'2026-11-09',status:'Присутствовал'};let gradeId;
 await t.test('teacher journal, grade corrections and history',async()=>{
  assert.deepEqual((await ok('teaching',undefined,teacher.cookie)).assignments.map(a=>a.id),[as1.id]);
  const j=await journal(teacher.cookie);assert.deepEqual(j.students.map(s=>s.id),[a.body.id]);assert.equal(j.attendance.length,0);
  assert.equal((await req('teaching/journal?assignment='+as2.id+'&date=2026-11-09',undefined,teacher.cookie)).status,404);
  assert.equal((await req('teaching/journal?assignment='+as1.id+'&date=2026-11-09',undefined,teacher2.cookie)).status,404);
  assert.equal((await req('teaching',undefined,a.cookie)).status,403);
  for(const sid of [b.body.id,c.body.id])assert.equal((await req('teaching/grade',{...grade,user_id:sid},teacher.cookie)).status,403);
  assert.equal((await req('teaching/grade',{...grade,assignment_id:as2.id},teacher.cookie)).status,404);
  assert.equal((await req('teaching/grade',{...grade,date:'2027-03-01'},teacher.cookie)).status,400);
  assert.equal((await req('teaching/grade',{...grade,score:'10'},teacher.cookie)).status,400);
  gradeId=(await ok('teaching/grade',grade,teacher.cookie)).id;await ok('teaching/grade',{...grade,id:gradeId,score:'5'},teacher.cookie);
  assert.equal((await ok('grades',undefined,a.cookie))[0].score,'5');assert.deepEqual(await ok('grades',undefined,b.cookie),[]);
  const hist=(await journal(teacher.cookie)).history;assert.equal(hist.length,2);assert.equal(JSON.parse(hist[0].old_json).score,'4');assert.equal(JSON.parse(hist[0].new_json).score,'5');
  const other=await ok('teaching/grade',{...grade,assignment_id:as2.id,user_id:b.body.id},teacher2.cookie);assert.equal((await req('teaching/grade',{...grade,id:other.id},teacher.cookie)).status,404);
 });
 await t.test('attendance, moved lessons and immutable used assignments',async()=>{
  await ok('teaching/attendance',mark,teacher.cookie);await ok('teaching/attendance',{...mark,status:'Опоздал'},teacher.cookie);
  const rows=await ok('attendance',undefined,a.cookie);assert.equal(rows.length,1);assert.equal(rows[0].status,'Опоздал');assert.deepEqual(await ok('attendance',undefined,b.cookie),[]);
  assert.equal((await req('teaching/attendance',{...mark,date:'2026-11-10'},teacher.cookie)).status,400);
  assert.equal((await req('teaching/attendance',{...mark,lesson_id:l2.id},teacher.cookie)).status,400);
  const ex={lesson_id:l1.id,original_date:'2026-11-16',new_date:'2026-11-17',start:'12:00',end:'13:20',room:'Тест-202',reason:'Тест переноса',cancelled:0};
  assert.equal((await req('manage/exceptions',{...ex,lesson_id:l2.id},staff.cookie)).status,404);await ok('manage/exceptions',ex,staff.cookie);
  assert.equal((await ok('schedule?date=2026-11-16',undefined,a.cookie)).lessons[0].status,'cancelled');assert.equal((await ok('schedule?date=2026-11-17',undefined,a.cookie)).lessons[0].room,'Тест-202');
  assert.equal((await req('teaching/attendance',{...mark,date:'2026-11-16'},teacher.cookie)).status,400);await ok('teaching/attendance',{...mark,date:'2026-11-17'},teacher.cookie);
  assert.equal((await req('manage/teaching_assignments',{...asData,id:as1.id,teacher_id:teacher2.body.id},ac)).status,409);
 });
 await t.test('dean requests, private documents and institute notices',async()=>{
  const r=await ok('requests',{type:'Справка об обучении',comment:'Изолированный тест'},a.cookie);
  assert.ok((await ok('inbox',undefined,staff.cookie)).requests.some(x=>x.id===r.id));assert.deepEqual((await ok('inbox',undefined,staff2.cookie)).requests,[]);
  assert.ok((await ok('notices',undefined,staff.cookie)).some(n=>n.title==='Новая заявка №'+r.id));assert.ok(!(await ok('notices',undefined,staff2.cookie)).some(n=>n.title==='Новая заявка №'+r.id));
  assert.equal((await req('requests/'+r.id,undefined,b.cookie)).status,404);assert.equal((await req('manage/requests',{id:r.id,status:'Готова',document:'Образец'},staff2.cookie)).status,404);
  await ok('manage/requests',{id:r.id,status:'Готова',reply:'Готово',document:'Образец'},staff.cookie);
  for(const [cookie,status]of [[a.cookie,200],[b.cookie,404]])assert.equal((await fetch(url+'/api/requests/'+r.id+'/document',{headers:{cookie}})).status,status);
  await ok('manage/notices',{title:'Для института А',body:'Тест',user_id:null,institute_id:i1},staff.cookie);
  assert.ok((await ok('notices',undefined,a.cookie)).some(n=>n.title==='Для института А'));assert.ok(!(await ok('notices',undefined,b.cookie)).some(n=>n.title==='Для института А'));
  assert.equal((await req('manage/notices',{title:'Весь вуз',body:'Тест',user_id:null,institute_id:null},staff.cookie)).status,403);
 });
 await t.test('trainers receive only their own section applications',async()=>{
  const club={title:'Тестовая секция А',category:'Спорт',description:'Только в тестовой базе',place:'Тест-1',weekday:2,start:'18:00',end:'19:20',capacity:1,owner:coach.body.id,enrollment_open:1,archived:0};
  const club1=await ok('manage/clubs',club,coach.cookie),club2=await ok('manage/clubs',{...club,title:'Тестовая секция Б',owner:coach2.body.id},coach2.cookie);
  await ok('join',{club_id:club1.id},a.cookie);await ok('join',{club_id:club1.id},a.cookie);await ok('join',{club_id:club2.id},b.cookie);
  const inbox=await ok('inbox',undefined,coach.cookie),inbox2=await ok('inbox',undefined,coach2.cookie);assert.equal(inbox.memberships.length,1);assert.equal(inbox2.memberships.length,1);assert.deepEqual(inbox.requests,[]);
  assert.equal((await req('manage/memberships',{id:inbox2.memberships[0].id,status:'Вы приняты'},coach.cookie)).status,404);
  await ok('manage/memberships',{id:inbox.memberships[0].id,status:'Вы приняты'},coach.cookie);assert.equal((await ok('schedule?date=2026-11-10',undefined,a.cookie)).clubs.length,1);
  assert.equal((await ok('notices',undefined,coach.cookie)).filter(n=>n.title==='Новая запись в секцию «Тестовая секция А»').length,1);
  assert.equal((await req('manage/clubs',{...club,id:club2.id},coach.cookie)).status,404);
 });
 await t.test('revocations and student transfers take effect without relogin',async()=>{
  await ok('manage/staff_scopes',{...scope,id:scopeId.id,active:0},ac);assert.equal((await ok('manage',undefined,staff.cookie)).entities.users.rows.length,0);assert.equal((await ok('inbox',undefined,staff.cookie)).requests.length,0);
  assert.equal((await req('teaching/journal?assignment='+as1.id+'&date=2026-11-09',undefined,staff.cookie)).status,404);
  await ok('manage/users',{...profiles.get('student-a'),group_id:g2.id,password:''},ac);
  const j=await journal(teacher.cookie);assert.equal(j.students.length,0);assert.equal(j.grades.length,0);assert.equal(j.history.length,0);
  assert.equal((await req('teaching/grade',{...grade,id:gradeId},teacher.cookie)).status,403);assert.equal((await ok('grades',undefined,a.cookie))[0].id,gradeId);assert.equal((await ok('me',undefined,a.cookie)).grp,'ТЕСТ-Б');
  await ok('manage/teaching_assignments',{...asData,id:as1.id,active:0},ac);assert.equal((await req('teaching/journal?assignment='+as1.id+'&date=2026-11-09',undefined,teacher.cookie)).status,404);
 });
 await t.test('theme, CSRF, account blocking and logout',async()=>{
  await ok('theme',{theme:'light'},b.cookie);assert.equal((await ok('me',undefined,b.cookie)).theme,'light');
  assert.equal((await fetch(url+'/api/theme',{method:'POST',headers:{cookie:b.cookie,'Content-Type':'application/json',Origin:'https://evil.example'},body:'{"theme":"dark"}'})).status,403);
  await ok('manage/users',{...profiles.get('student-c'),password:'',active:0},ac);assert.equal((await req('me',undefined,c.cookie)).status,401);
  await ok('logout',{},b.cookie);assert.equal((await req('me',undefined,b.cookie)).status,401);
 });
 assert.ok(!errors.includes('Error:'),errors);
});
