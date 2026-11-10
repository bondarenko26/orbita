import {Worker} from 'node:worker_threads';
import {randomBytes} from 'node:crypto';
import {TEMP_LIFETIME,uniqueLogin} from './credentials.mjs';
let working=false;
function job(task,values){
 if(working)throw Object.assign(Error('Обрабатывается другой файл. Повторите через несколько секунд'),{status:429});working=true;
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./account-worker.mjs',import.meta.url),{workerData:{task,...values},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate().finally(()=>{working=false;error?reject(error):resolve(result)})};
  const timer=setTimeout(()=>finish(Object.assign(Error('Обработка заняла слишком много времени. Уменьшите файл'),{status:400})),30000);
  worker.on('message',m=>finish(m.ok?null:Object.assign(Error(m.error),{status:400}),m.result));worker.on('error',()=>finish(Object.assign(Error('Не удалось обработать файл. Используйте шаблон и не более 200 строк'),{status:400})));worker.on('exit',()=>{if(!settled)finish(Object.assign(Error('Обработка файла прервана'),{status:400}))});
 });
}
export function installAccounts(db,{fail,management,tokenHash}){
 const one=(sql,...p)=>db.prepare(sql).get(...p),all=(sql,...p)=>db.prepare(sql).all(...p),run=(sql,...p)=>db.prepare(sql).run(...p),tickets=new Map();
 db.exec('CREATE TABLE IF NOT EXISTS account_imports(id TEXT PRIMARY KEY,actor INTEGER REFERENCES users(id),count INTEGER NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP)');
 const clean=()=>{for(const [id,t]of tickets)if(t.expires<Date.now())tickets.delete(id)};
 function allowed(u){if(!['admin','staff'].includes(u.role))fail(403,'Регистрация доступна администратору и деканату')}
 function fresh(session){const u=one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',session,Date.now());if(!u)fail(401,'Войдите в аккаунт');if(u.must_change_password)fail(403,'Сначала смените временный пароль');allowed(u);return u}
 const normalize=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
 function prepare(rows,u){
  const seen=new Set(),logins=new Set(),existing=all("SELECT * FROM users WHERE role IN ('student','teacher')");
  return rows.map(row=>{const errors=[],role=({'студент':'student','преподаватель':'teacher'})[normalize(row.role)],name=row.name.trim();let group=null,institute=null;
   if(!name||name.length>200||/[\x00-\x1f]/.test(name))errors.push('Укажите ФИО обычным текстом');if(!role)errors.push('Роль: Студент или Преподаватель');
   if(role==='student'){
    group=one('SELECT * FROM groups WHERE name=?',row.group);if(!group?.program_id||!management.academic.allowedInstitute(u,group.institute_id)){errors.push('Группа не найдена, не связана с МГСУ или недоступна');group=null}
    if(row.institute)errors.push('Для студента оставьте институт пустым: он определяется по группе');
   }else if(role==='teacher'){
    institute=one("SELECT * FROM academic_nodes WHERE id=? AND kind='institute'",row.institute);if(!institute||!management.academic.allowedInstitute(u,institute.id)){errors.push('Код института не найден или недоступен');institute=null}
    if(row.group||row.subgroup)errors.push('Для преподавателя оставьте группу и подгруппу пустыми. Назначения создаются отдельно');
   }
   const key=JSON.stringify([normalize(name),role,group?.id||null,row.subgroup,institute?.id||null]);if(seen.has(key))errors.push('Повтор строки в файле');seen.add(key);
   if(role&&existing.some(e=>normalize(e.name)===normalize(name)&&e.role===role&&(role==='student'?e.group_id===group?.id&&e.subgroup===row.subgroup:e.institute_id===institute?.id)))errors.push('Такой аккаунт уже есть. Для полного тёзки используйте ручное создание');
   let login=row.login;if(login){if(one('SELECT id FROM users WHERE login=?',login)||logins.has(login))errors.push('Логин уже занят, проверьте файл повторно')}else login=uniqueLogin(role,v=>logins.has(v)||one('SELECT id FROM users WHERE login=?',v));logins.add(login);
   return {...row,name,login,role_label:row.role,normalized_role:role,group_id:group?.id||null,institute_id:institute?.id||group?.institute_id||null,errors};
  });
 }
 async function handle(p,method,b,u,send,res,url,session){
  if(!p.startsWith('/api/accounts/'))return false;allowed(u);clean();
  if(p==='/api/accounts/template'&&method==='GET'){
   const meta=management.academic.meta(u),groups=management.academic.filter('groups',all('SELECT * FROM groups WHERE program_id IS NOT NULL'),u),institutes=meta.catalog.filter(n=>n.kind==='institute'&&meta.scopes.includes(n.id));
   const bytes=await job('template',{data:{groups,institutes}});fresh(session);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="orbita-accounts-template.xlsx"','Cache-Control':'no-store'});res.end(Buffer.from(bytes));return true;
  }
  if(p==='/api/accounts/preview'&&method==='POST'){
   if(!b.file_name?.toLowerCase().endsWith('.xlsx')||typeof b.file!=='string'||!b.file.length||b.file.length>1400000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.file))fail(400,'Выберите файл .xlsx размером до 1 МБ');
   const buffer=Buffer.from(b.file,'base64');if(buffer.length>1024*1024)fail(413,'Размер файла — до 1 МБ');
   const source=await job('parse',{buffer});u=fresh(session);const rows=prepare(source,u),valid=rows.every(r=>!r.errors.length);
   for(const [id,t]of tickets)if(t.session===session)tickets.delete(id);if(tickets.size>=20)fail(429,'Слишком много проверок. Повторите позже');
   const id=randomBytes(24).toString('hex'),expires=Date.now()+15*60000;
   if(valid)tickets.set(id,{session,rows,expires,busy:false});
   send({token:valid?id:null,expires,valid,count:rows.length,rows:rows.map(({row,name,role_label,group,subgroup,institute,login,errors})=>({row,name,role:role_label,group,subgroup,institute,login,errors}))});return true;
  }
  if(p==='/api/accounts/commit'&&method==='POST'){
   const t=tickets.get(b.token);if(!t||t.session!==session||t.expires<Date.now())fail(409,'Предпросмотр истёк или уже использован. Загрузите файл заново');if(t.busy)fail(409,'Этот список уже обрабатывается');t.busy=true;
   try{
    let rows=prepare(t.rows,fresh(session));if(rows.some(r=>r.errors.length))fail(409,'Данные или права изменились. Проверьте файл заново');
    const secrets=await job('credentials',{count:rows.length});u=fresh(session);rows=prepare(t.rows,u);if(rows.some(r=>r.errors.length))fail(409,'Данные или права изменились. Проверьте файл заново');
    const expires=Date.now()+TEMP_LIFETIME,credentials=[];db.exec('BEGIN IMMEDIATE');try{
     run('INSERT INTO account_imports(id,actor,count) VALUES(?,?,?)',tokenHash(b.token),u.id,rows.length);
     rows.forEach((row,i)=>{const v={login:row.login,name:row.name,role:row.normalized_role,group_id:row.group_id,subgroup:row.subgroup,institute_id:row.institute_id,active:1};management.academic.validate('users',v,u,null);v.password=secrets[i].hash;v.must_change_password=1;v.temporary_password_expires=expires;const keys=Object.keys(v),id=Number(run(`INSERT INTO users(${keys}) VALUES(${keys.map(()=>'?')})`,...keys.map(k=>v[k])).lastInsertRowid);run("INSERT INTO audit(actor,action,entity,record_id) VALUES(?,'import','users',?)",u.id,id);credentials.push({id,name:v.name,login:v.login,password:secrets[i].password,role:row.role_label,group:row.group,institute:row.institute,expires})});db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e}
    tickets.delete(b.token);send({count:credentials.length,credentials});return true;
   }finally{t.busy=false}
  }
  if(p==='/api/accounts/export'&&method==='POST'){
   if(!Array.isArray(b.credentials)||!b.credentials.length||b.credentials.length>200)fail(400,'Выберите от 1 до 200 аккаунтов');
   const rows=b.credentials.map(c=>{const target=one('SELECT * FROM users WHERE id=?',Number(c.id)||0);if(!target||!target.must_change_password||!management.academic.filter('users',[target],u).length)fail(409,'Аккаунт недоступен или пароль уже изменён');if(typeof c.password!=='string'||c.password.length>200)fail(400,'Пароль отсутствует');return {id:target.id,name:target.name,login:target.login,password:c.password,hash:target.password,group:target.grp,institute:target.institute_id,expires:target.temporary_password_expires}});
   const bytes=await job('export',{rows,origin:process.env.PUBLIC_ORIGIN||url.origin});u=fresh(session);for(const row of rows){const target=one('SELECT * FROM users WHERE id=?',row.id);if(!target||target.password!==row.hash||!management.academic.filter('users',[target],u).length)fail(409,'Данные или права изменились. Выдайте новый временный пароль')}
   res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="orbita-access.xlsx"','Cache-Control':'no-store'});res.end(Buffer.from(bytes));return true;
  }
  if(p==='/api/accounts/reset'&&method==='POST'){
   const target=one('SELECT * FROM users WHERE id=?',Number(b.id)||0);if(!target||!management.academic.filter('users',[target],u).length)fail(404,'Аккаунт не найден');if(target.id===u.id)fail(400,'Свой пароль меняйте в профиле');
   const [secret]=await job('credentials',{count:1});u=fresh(session);const current=one('SELECT * FROM users WHERE id=?',target.id);if(!current||!management.academic.filter('users',[current],u).length)fail(404,'Аккаунт не найден');
   const expires=Date.now()+TEMP_LIFETIME;db.exec('BEGIN IMMEDIATE');try{run('UPDATE users SET password=?,must_change_password=1,temporary_password_expires=? WHERE id=?',secret.hash,expires,current.id);run('DELETE FROM sessions WHERE user_id=?',current.id);run('DELETE FROM password_attempts WHERE user_id=?',current.id);run("INSERT INTO audit(actor,action,entity,record_id) VALUES(?,'password_reset','users',?)",u.id,current.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
   send({credentials:[{id:current.id,name:current.name,login:current.login,password:secret.password,expires}]});return true;
  }
  return false;
 }
 return {handle};
}
