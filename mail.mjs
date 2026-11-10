import nodemailer from 'nodemailer';
import {randomBytes,randomInt,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {normalizeEmail,validEmail,temporaryPassword,TEMP_LIFETIME} from './credentials.mjs';
export function installMail(db,{dir,fail,credentials,hashPassword,scope}){
 const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 if(!all('PRAGMA table_info(users)').some(c=>c.name==='email'))db.exec('ALTER TABLE users ADD COLUMN email TEXT');
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS unique_user_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
 CREATE TABLE IF NOT EXISTS mail_jobs(id INTEGER PRIMARY KEY,user_id INTEGER,recipient TEXT,kind TEXT,state TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,next_attempt INTEGER DEFAULT 0,payload TEXT,guard TEXT,expires INTEGER,error TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS email_changes(user_id INTEGER PRIMARY KEY,email TEXT,code_hash TEXT,expires INTEGER,attempts INTEGER DEFAULT 0,password_hash TEXT);`);
 const port=Number(process.env.SMTP_PORT||465),test=process.env.NODE_ENV==='test'&&process.env.SMTP_HOST==='127.0.0.1';
 const configured=!!(process.env.SMTP_HOST&&validEmail(normalizeEmail(process.env.SMTP_FROM))&&(test||process.env.SMTP_USER&&process.env.SMTP_PASS)&&process.env.PUBLIC_ORIGIN);
 let key,transport;
 if(configured){const file=process.env.MAIL_KEY_FILE||path.join(dir,'mail.key');if(!existsSync(file))writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'});key=readFileSync(file);if(key.length!==32)throw Error('Invalid mail encryption key');transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:!test&&port!==465,ignoreTLS:test,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false})}
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const encrypt=value=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64')};
 const decrypt=value=>{const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString())};
 function requireReady(){if(!configured)fail(503,'Почтовая отправка ещё не настроена. Аккаунты не созданы. Обратитесь к администратору')}
 function enqueue(userId,email,kind,body,guard,expires){requireReady();return Number(run('INSERT INTO mail_jobs(user_id,recipient,kind,payload,guard,expires) VALUES(?,?,?,?,?,?)',userId,email,kind,encrypt(body),guard,expires).lastInsertRowid)}
 function invite(id,password){const u=one('SELECT * FROM live_users WHERE id=?',id);if(!u?.email)fail(400,'Укажите email аккаунта');run("UPDATE mail_jobs SET state='cancelled',payload=NULL WHERE user_id=? AND kind='invite' AND state IN ('pending','failed')",id);enqueue(id,u.email,'invite',{subject:'Орбита: доступ к личному кабинету',text:`Ваш логин: ${u.email}\nВременный пароль: ${password}\n\nВход: ${process.env.PUBLIC_ORIGIN}\nПароль действует 7 дней. При первом входе задайте свой пароль.\n\nКонкурсный концепт, неофициальный сервис МГСУ.`},u.password,u.temporary_password_expires)}
 run("UPDATE mail_jobs SET state='pending' WHERE state='sending'");let busy=false;
 async function tick(){if(busy||!configured)return;busy=true;try{
  const j=one("SELECT * FROM mail_jobs WHERE state='pending' AND next_attempt<=? ORDER BY id LIMIT 1",Date.now());if(!j)return;
  const u=one('SELECT * FROM live_users WHERE id=? AND active=1',j.user_id),change=one('SELECT * FROM email_changes WHERE user_id=?',j.user_id);
  if(!u||j.expires<Date.now()||(j.kind==='invite'?(u.password!==j.guard||u.email!==j.recipient||!u.must_change_password):(u.password!==change?.password_hash||change?.email!==j.recipient||change?.code_hash!==j.guard))){run("UPDATE mail_jobs SET state='cancelled',payload=NULL WHERE id=?",j.id);return}
  run("UPDATE mail_jobs SET state='sending',attempts=attempts+1 WHERE id=?",j.id);
  try{const body=decrypt(j.payload);const info=await transport.sendMail({from:{name:'Орбита · цифровой деканат',address:process.env.SMTP_FROM},to:j.recipient,messageId:`<orbita-${j.id}@${process.env.SMTP_FROM.split('@')[1]}>`,...body});if(!info.accepted?.length)throw Error('Rejected');run("UPDATE mail_jobs SET state='sent',payload=NULL,error=NULL WHERE id=?",j.id)}catch(e){const failed=j.attempts>=2;run('UPDATE mail_jobs SET state=?,next_attempt=?,payload=?,error=? WHERE id=?',failed?'failed':'pending',Date.now()+60000*(j.attempts+1),failed?null:j.payload,'Почтовый сервер не принял письмо. Проверьте настройки и адрес; выдайте новый пароль для повторной отправки.',j.id)}
 }finally{busy=false}}
 const timer=setInterval(tick,2000);timer.unref();
 function handle(p,method,b,u,send,res){
  if(p==='/api/mail/status'&&method==='GET'){if(!['admin','staff'].includes(u.role))fail(403,'Нет доступа');const allowed=new Set(scope(u,all('SELECT * FROM users')).map(s=>s.id));send({configured,jobs:all('SELECT id,user_id,recipient,state,error,created FROM mail_jobs ORDER BY id DESC').filter(j=>allowed.has(j.user_id)).slice(0,200)});return true}
  if(p==='/api/accounts/email'&&method==='POST'){
   if(!['admin','staff'].includes(u.role))fail(403,'Email меняет администратор или деканат');requireReady();credentials.checkCurrent(b.current_password,u);const target=one('SELECT * FROM live_users WHERE id=?',Number(b.id)||0);if(!target||!scope(u,[target]).length)fail(404,'Аккаунт не найден');if(target.id===u.id)fail(400,'Свой email меняйте в профиле с подтверждением');
   const email=normalizeEmail(b.email);if(!validEmail(email))fail(400,'Проверьте email');if(one('SELECT id FROM users WHERE id<>? AND (lower(login)=? OR email=? COLLATE NOCASE)',target.id,email,email))fail(409,'Этот email уже занят');if(email===target.email)fail(400,'Адрес уже указан');
   const password=temporaryPassword();db.exec('BEGIN');try{run('UPDATE users SET login=?,email=?,password=?,must_change_password=1,temporary_password_expires=? WHERE id=?',email,email,hashPassword(password),Date.now()+TEMP_LIFETIME,target.id);run('DELETE FROM sessions WHERE user_id=?',target.id);run('DELETE FROM password_attempts WHERE user_id=?',target.id);invite(target.id,password);run("INSERT INTO audit(actor,action,entity,record_id) VALUES(?,'email_change','users',?)",u.id,target.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send({mail_queued:true});return true;
  }
  if(p==='/api/email/request'&&method==='POST'){
   if(!['admin','staff'].includes(u.role))fail(403,'Email меняет администратор или деканат');requireReady();credentials.checkCurrent(b.current_password,u);const email=normalizeEmail(b.email);if(!validEmail(email))fail(400,'Проверьте email');if(email===u.email)fail(400,'Укажите другой адрес');if(one('SELECT id FROM users WHERE lower(login)=? OR email=? COLLATE NOCASE',email,email))fail(409,'Этот email уже занят');
   const recent=one("SELECT created FROM mail_jobs WHERE user_id=? AND kind='email' ORDER BY id DESC LIMIT 1",u.id);if(recent&&Date.now()-Date.parse(recent.created+'Z')<60000)fail(429,'Повторный код можно запросить через минуту');
   const code=String(randomInt(100000,1000000)),expires=Date.now()+15*60000,codeHash=hash(code);db.exec('BEGIN');try{run('INSERT INTO email_changes VALUES(?,?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,expires=excluded.expires,attempts=0,password_hash=excluded.password_hash',u.id,email,codeHash,expires,u.password);enqueue(u.id,email,'email',{subject:'Орбита: подтверждение нового email',text:`Код подтверждения: ${code}\nДействует 15 минут. Введите его в профиле Орбиты. Если вы не меняли email, проигнорируйте письмо.`},codeHash,expires);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send({ok:true,message:'Код поставлен в очередь отправки. Старый логин действует до подтверждения.'});return true;
  }
  if(p==='/api/email/confirm'&&method==='POST'){
   if(!['admin','staff'].includes(u.role))fail(403,'Email меняет администратор или деканат');const c=one('SELECT * FROM email_changes WHERE user_id=?',u.id);if(!c||c.expires<Date.now()||c.attempts>=5||c.password_hash!==u.password)fail(400,'Код истёк. Запросите новый');if(typeof b.code!=='string'||!timingSafeEqual(Buffer.from(hash(b.code)),Buffer.from(c.code_hash))){run('UPDATE email_changes SET attempts=attempts+1 WHERE user_id=?',u.id);fail(400,'Неверный код')}
   if(one('SELECT id FROM users WHERE id<>? AND (lower(login)=? OR email=? COLLATE NOCASE)',u.id,c.email,c.email))fail(409,'Этот email уже занят');
   db.exec('BEGIN');try{run('UPDATE users SET email=?,login=? WHERE id=?',c.email,c.email,u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);run('DELETE FROM email_changes WHERE user_id=?',u.id);run("INSERT INTO audit(actor,action,entity,record_id) VALUES(?,'email_change','users',?)",u.id,u.id);credentials.issueSession(u.id,res);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send({ok:true});return true;
  }
  return false;
 }
 return {configured,requireReady,invite,handle,tick,close(){clearInterval(timer);transport?.close()}};
}
