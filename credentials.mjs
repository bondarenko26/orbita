import {randomBytes,randomInt,createHash} from 'node:crypto';
export const TEMP_LIFETIME=7*86400000;
export function migrateCredentials(db){
 const cols=db.prepare('PRAGMA table_info(users)').all();
 for(const [name,type]of Object.entries({must_change_password:'INTEGER NOT NULL DEFAULT 0',temporary_password_expires:'INTEGER'}))if(!cols.some(c=>c.name===name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
 db.exec('CREATE TABLE IF NOT EXISTS password_attempts(user_id INTEGER PRIMARY KEY REFERENCES users(id),attempts INTEGER NOT NULL,until INTEGER NOT NULL)');
}
export const PASSWORD_RULE='8–14 символов, минимум 3 латинские буквы, минимум одна заглавная латинская буква или один спецсимвол. Без пробелов.';
export function passwordError(p){return typeof p!=='string'||[...p].length<8||[...p].length>14||/\s/.test(p)||(p.match(/[a-z]/gi)||[]).length<3||!(/[A-Z]/.test(p)||/[^\p{L}\p{N}\s]/u.test(p))?PASSWORD_RULE:null}
export const temporaryPassword=()=>{const chars='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%';let p;do{p=Array.from({length:14},()=>chars[randomInt(chars.length)]).join('')}while(passwordError(p));return p};
export const normalizeEmail=v=>typeof v==='string'?v.trim().toLowerCase():'';
export const validEmail=v=>typeof v==='string'&&v.length<=200&&/^[a-z0-9][a-z0-9.!#$%&'*+\/=?^_`{|}~-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v)&&!v.split('@')[0].includes('..')&&!v.split('@')[0].endsWith('.');
export const uniqueLogin=(role,exists)=>{let login;do{login=(role==='student'?'s-':role==='teacher'?'t-':'u-')+randomBytes(5).toString('hex')}while(exists(login));return login};
export function installCredentials(db,{fail,hash,verify}){
 const one=(sql,...p)=>db.prepare(sql).get(...p),run=(sql,...p)=>db.prepare(sql).run(...p);
 function issueSession(userId,res){const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',createHash('sha256').update(token).digest('hex'),userId,Date.now()+86400000);res.setHeader('Set-Cookie',`orbita=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.PUBLIC_ORIGIN?.startsWith('https:')?'; Secure':''}`)}
 function checkCurrent(p,u){
  const attempt=one('SELECT * FROM password_attempts WHERE user_id=?',u.id);if(attempt&&attempt.until>Date.now()&&attempt.attempts>=5)fail(429,'Слишком много неверных паролей. Повторите через 15 минут');
  if(typeof p!=='string'||p.length>200||!verify(p,u.password)){
   const count=attempt&&attempt.until>Date.now()?attempt.attempts+1:1,until=attempt&&attempt.until>Date.now()?attempt.until:Date.now()+900000;
   run('INSERT INTO password_attempts VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET attempts=excluded.attempts,until=excluded.until',u.id,count,until);fail(400,'Текущий пароль неверен');
  }
 }
 function change(b,u,res){checkCurrent(b.current_password,u);
  const error=passwordError(b.new_password);if(error)fail(400,error);if(b.new_password!==b.confirm_password)fail(400,'Новые пароли не совпадают');if(verify(b.new_password,u.password))fail(400,'Новый пароль должен отличаться от текущего');
  const next=hash(b.new_password);
  db.exec('BEGIN IMMEDIATE');try{run('UPDATE users SET password=?,must_change_password=0,temporary_password_expires=NULL WHERE id=?',next,u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);run('DELETE FROM password_attempts WHERE user_id=?',u.id);run("INSERT INTO audit(actor,action,entity,record_id) VALUES(?,'password_change','users',?)",u.id,u.id);issueSession(u.id,res);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  return one('SELECT * FROM users WHERE id=?',u.id);
 }
 return {change,checkCurrent,issueSession};
}
