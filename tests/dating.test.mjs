import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {installDating} from '../dating.mjs';
import {checkDatingText,moderateEdition} from '../dating-moderation.mjs';

const sample=Buffer.from([255,216,1,255,217]);
const safe={state:'approved',field:'',reason:'',photo:sample};
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,active INTEGER DEFAULT 1,deleted_at TEXT);
    CREATE VIEW live_users AS SELECT * FROM users WHERE deleted_at IS NULL;
    CREATE TABLE notices(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,body TEXT);`);
  function user(id,role='student'){db.prepare('INSERT INTO users(id,role) VALUES(?,?)').run(id,role);return id}
  const service=installDating(db,(status,message)=>{throw Object.assign(Error(message),{status})});
  function request(id,action,body){
    const account=db.prepare('SELECT * FROM users WHERE id=?').get(id);
    let value;
    const res={writeHead(status,headers){assert.equal(status,200);assert.equal(headers['Cache-Control'],'private, no-store')},end(bytes){value=Buffer.from(bytes)}};
    assert.ok(service.handle('/api/dating/'+action,body===undefined?'GET':'POST',body||{},account,data=>{value=data},res,()=>{}));
    return value;
  }
  const accept=id=>request(id,'accept',{adult:true,rules:1});
  const state=id=>request(id,'state');
  function submit(id,overrides={}){
    return request(id,'profile',{alias:'Студент '+id,age:21,purpose:'Дружба',interests:'спорт, книги',about:'Группа 1-40, 2 курс, живу в общежитии № 3.',
      telegram:'fiction_'+id,image:sample.toString('base64'),previous:state(id).own?.id??null,...overrides});
  }
  function publish(id){
    accept(id);submit(id);const job=service.queue.take();assert.equal(job.owner,id);service.queue.finish(job,safe);
    return db.prepare('SELECT id FROM dating_profiles WHERE owner=?').get(id).id;
  }
  return {db,user,request,accept,state,submit,publish,queue:service.queue};
}

test('consent, audience for photos and immediate sender-only disclosure on invitations',t=>{
  const {db,user,request,accept,state,publish}=fixture(t);
  const alex=user(1),vika=user(2),reader=user(3),admin=user(4,'admin'),staff=user(5,'staff'),young=user(6);
  assert.deepEqual(state(young),{accepted:false});
  assert.throws(()=>request(young,'accept',{adult:false,rules:1}),{status:400});
  assert.throws(()=>request(staff,'accept',{adult:true,rules:1}),{status:403});
  const a=publish(alex),v=publish(vika);
  accept(reader);
  assert.ok(state(reader).card);assert.equal(state(reader).canInvite,false);
  assert.doesNotMatch(JSON.stringify(state(reader)),/fiction_|telegram|owner/i);
  const photo=state(reader).card.photo.split('/dating/')[1];
  assert.deepEqual(request(reader,photo),sample);
  for(const [id,code] of [[young,403],[staff,403],[admin,404]])assert.throws(()=>request(id,photo),{status:code});
  assert.throws(()=>request(reader,'invite',{profile:a}),{status:403});
  request(alex,'invite',{profile:v});request(alex,'invite',{profile:v});
  assert.equal(state(alex).remaining,19);assert.equal(state(alex).inbox.length,0);
  assert.equal(state(vika).inbox[0].telegram,'fiction_1');
  assert.doesNotMatch(JSON.stringify(state(alex)),/fiction_2/);
  assert.doesNotMatch(JSON.stringify(state(reader)),/fiction_1|fiction_2/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM notices').get().n,1);
  assert.doesNotMatch(db.prepare('SELECT body FROM notices').get().body,/fiction/);
  request(vika,'visibility',{visible:false});assert.equal(state(vika).inbox.length,0);
  assert.throws(()=>request(reader,'invite',{profile:v}),{status:404});
  request(vika,'visibility',{visible:true});assert.equal(state(vika).inbox.length,1);
  request(vika,'block',{profile:a});assert.equal(state(vika).inbox.length,0);
  for(const [viewer,other] of [[vika,a],[alex,v]])assert.throws(()=>request(viewer,'invite',{profile:other}),{status:404});
  assert.throws(()=>request(vika,photo),{status:404});
  const block=state(vika).blocked[0];assert.equal(block.label,'Студент 1');
  request(reader,'unblock',{id:block.id});assert.equal(state(vika).blocked.length,1);
  request(vika,'unblock',{id:block.id});assert.deepEqual(request(vika,photo),sample);
  assert.equal(state(vika).inbox.length,0);
  db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run('removed',alex);
  assert.throws(()=>request(reader,photo),{status:404});
});

test('distinct contacts quota survives deletion and recreation; skips and duplicate submissions do not consume it',t=>{
  const {db,user,request,state,publish}=fixture(t);const sender=user(1);publish(sender);
  const profiles=Array.from({length:21},(_,i)=>publish(user(i+2)));
  for(const profile of profiles){request(sender,'skip',{profile});}
  assert.equal(state(sender).remaining,20);assert.equal(state(sender).card,null);
  request(sender,'reset-skips',{});assert.ok(state(sender).card);
  for(const profile of profiles.slice(0,20))request(sender,'invite',{profile});
  request(sender,'invite',{profile:profiles[0]});
  assert.throws(()=>request(sender,'invite',{profile:profiles[20]}),{status:429});
  request(sender,'delete',{});assert.equal(state(sender).own,null);
  publish(sender);assert.equal(state(sender).remaining,0);
  assert.equal(state(2).inbox.length,0);
  assert.throws(()=>request(sender,'invite',{profile:profiles[20]}),{status:429});
  db.prepare("UPDATE dating_daily SET day='2001-01-01'").run();
  request(sender,'invite',{profile:profiles[20]});assert.equal(state(sender).remaining,19);
});

test('pending edits, worker leases, reports and appeals are scoped to the actual edition',t=>{
  const {db,user,request,state,accept,publish,submit,queue}=fixture(t);
  const author=user(1),reader=user(2),admin=user(3,'admin'),staff=user(4,'staff');
  const profile=publish(author);accept(reader);
  submit(author,{alias:'Версия два'});const stale=queue.take();
  submit(author,{alias:'Версия три'});queue.finish(stale,safe);
  const job=queue.take();assert.equal(job.alias,'Версия три');
  queue.retry(job);assert.equal(queue.take(),null);assert.equal(state(author).own.state,'pending');
  assert.equal(state(reader).card.alias,'Студент 1');
  db.prepare('UPDATE dating_editions SET available=0 WHERE id=?').run(job.id);
  const delayed=queue.take();queue.finish(job,safe);assert.equal(state(author).own.state,'pending');
  queue.finish(delayed,{...safe,state:'rejected',field:'Фото',reason:'Проверка фотографии'});
  const pendingPhoto=state(author).own.photo.split('/dating/')[1];
  assert.deepEqual(request(author,pendingPhoto),sample);assert.throws(()=>request(reader,pendingPhoto),{status:404});
  request(author,'appeal',{detail:'Прошу перепроверить изображение.'});
  request(reader,'report',{profile,detail:'Проверьте описание.'});
  assert.throws(()=>request(staff,'cases'),{status:403});
  const cases=request(admin,'cases');assert.equal(cases.length,2);
  assert.doesNotMatch(JSON.stringify(cases),/fiction_|telegram/i);assert.deepEqual(request(admin,pendingPhoto),sample);
  request(admin,'decide',{id:cases.find(c=>c.kind==='appeal').id,decision:'approve'});
  request(admin,'decide',{id:cases.find(c=>c.kind==='report').id,decision:'reject',reason:'Прошлая версия нарушала правила.'});
  request(reader,'reset-skips',{});assert.equal(state(reader).card.alias,'Версия три');
  assert.throws(()=>request(admin,pendingPhoto),{status:404});
  request(reader,'report',{profile,detail:'Прошу проверить актуальную версию.'});
  request(admin,'decide',{id:request(admin,'cases')[0].id,decision:'reject',reason:'Нужны изменения в анкете.'});
  assert.equal(state(author).own.live,false);
  submit(author,{image:undefined});const again=queue.take();queue.finish(again,{...safe,state:'review',reason:'Спорный снимок',field:'Фото'});
  assert.equal(state(author).own.state,'review');assert.equal(request(admin,'cases')[0].kind,'review');
  request(author,'delete',{});assert.equal(request(admin,'cases').length,0);assert.equal(db.prepare('SELECT count(*) n FROM dating_editions').get().n,0);
});

test('local moderation checks public text, OCR, QR codes and model decisions before publication',async()=>{
  const p={alias:'Луна',about:'2 курс, группа 1-40, живу в общежитии № 3.',interests:'спорт, театр',source:sample};
  const photo={jpeg:sample.toString('base64'),ocr:'',qr:false,score:0.04};
  const analyze=async(edition=p,change={},scores=[0.02,0.03,0,0])=>moderateEdition(edition,async()=>({...photo,...change}),async()=>({scores}));
  assert.equal((await analyze()).state,'approved');
  for(const input of ['продам подписку','+7 (999) 123-45-67','https://example.test','@test_student','abc@example.test','пиши в t.me/name','ты дебил'])assert.ok(checkDatingText(input),input);
  for(const input of [p.about,'Общежитие 4, 3 курс','Люблю книги и пешие прогулки.'])assert.equal(checkDatingText(input),'',input);
  assert.equal((await analyze({...p,about:'@fiction_1'})).field,'О себе');
  assert.equal((await analyze(p,{qr:true})).state,'rejected');
  assert.equal((await analyze(p,{ocr:'test@example.test'})).field,'Фото');
  assert.equal((await analyze(p,{score:0.6})).state,'review');
  assert.equal((await analyze(p,{score:0.98})).state,'rejected');
  assert.equal((await analyze(p,{invalid:true})).photo,null);
  assert.equal((await analyze(p,{},[0,0.97,0,0])).field,'О себе');
  await assert.rejects(analyze(p,{},[]));
  await assert.rejects(moderateEdition(p,async()=>{throw Error('unavailable')}));
});
