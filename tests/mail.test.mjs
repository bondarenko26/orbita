import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {installMail} from '../mail.mjs';
import {fakeSMTP} from './helpers.mjs';
test('mail queue encrypts secrets, survives restart and reports retry failures',async()=>{
 const config={reject:true},smtp=await fakeSMTP(config),saved={...process.env},dir=mkdtempSync(path.join(os.tmpdir(),'orbita-mail-'));
 Object.assign(process.env,smtp.env);delete process.env.SMTP_USER;delete process.env.SMTP_PASS;
 const db=new DatabaseSync(path.join(dir,'test.sqlite'));
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,password TEXT,must_change_password INTEGER,temporary_password_expires INTEGER,active INTEGER);CREATE VIEW live_users AS SELECT * FROM users`);
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(1,'test@example.test','hash-only',1,Date.now()+60000,1);
 const ctx={dir,fail:(status,message)=>{throw Object.assign(Error(message),{status})},credentials:{},hashPassword:()=>'',scope:(_,v)=>v};
 let mail=installMail(db,ctx);
 try{
  mail.invite(1,'SecretABC!12');let job=db.prepare('SELECT * FROM mail_jobs').get();assert.ok(job.payload.length>100);assert.ok(!job.payload.includes('SecretABC!12'));assert.equal(job.state,'pending');
  mail.close();mail=installMail(db,ctx);await mail.tick();job=db.prepare('SELECT * FROM mail_jobs').get();assert.equal(job.attempts,1);assert.equal(job.state,'pending');assert.ok(job.payload);assert.ok(job.error);assert.equal(smtp.messages.length,0);
  for(let i=0;i<2;i++){db.exec('UPDATE mail_jobs SET next_attempt=0');await mail.tick()}
  job=db.prepare('SELECT * FROM mail_jobs').get();assert.equal(job.state,'failed');assert.equal(job.attempts,3);assert.equal(job.payload,null);
  config.reject=false;mail.invite(1,'SecretXYZ!34');await mail.tick();assert.equal((await smtp.wait('test@example.test')).text.includes('SecretXYZ!34'),true);assert.equal(db.prepare('SELECT state FROM mail_jobs ORDER BY id DESC').get().state,'sent');
  mail.invite(1,'OldSecret!56');db.exec("UPDATE users SET password='changed'");await mail.tick();assert.equal(db.prepare('SELECT state,payload FROM mail_jobs ORDER BY id DESC').get().state,'cancelled');assert.equal(smtp.messages.length,1);
 }finally{mail.close();db.close();await smtp.close();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);rmSync(dir,{recursive:true,force:true})}
});
