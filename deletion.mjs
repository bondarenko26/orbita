const tables=['groups','users','lessons','clubs','events','grades'];
let enabled=false;
export const liveSql=sql=>enabled?sql.replace(/\b(FROM|JOIN)\s+(groups|users|lessons|clubs|events|grades)\b/gi,(_,verb,table)=>verb+' live_'+table.toLowerCase()):sql;
export function installDeletion(db,{fail,academic}){
 for(const table of tables){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='deleted_at'))db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);db.exec(`CREATE VIEW IF NOT EXISTS live_${table} AS SELECT * FROM ${table} WHERE deleted_at IS NULL`)}db.exec('CREATE VIEW IF NOT EXISTS history_users AS SELECT * FROM users');enabled=true;
 const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 function access(table,row,u){
  if(u.role==='admin')return true;
  if(u.role==='staff'&&['groups','users','lessons','grades'].includes(table))return academic.filter(table,[row],u).length>0;
  if(u.role==='manager'&&['clubs','events'].includes(table))return row.owner===u.id;
  if(u.role==='teacher'&&table==='grades'){const a=one('SELECT * FROM teaching_assignments WHERE id=?',row.assignment_id||0),s=one('SELECT * FROM live_users WHERE id=?',row.user_id);return a?.active===1&&a.teacher_id===u.id&&s?.group_id===a.group_id&&(!a.subgroup||a.subgroup===s.subgroup)}
  return false;
 }
 function check(table,r,restore,u){
  if(table==='users'){
   if(r.id===u.id)fail(409,'Нельзя удалить свой аккаунт');
   if(!restore&&r.role==='teacher'&&one('SELECT id FROM teaching_assignments WHERE teacher_id=? AND active=1',r.id))fail(409,'Сначала закройте назначения преподавателя');
   if(!restore&&(one('SELECT id FROM live_clubs WHERE owner=?',r.id)||one('SELECT id FROM live_events WHERE owner=?',r.id)))fail(409,'Сначала передайте или удалите секции и события этого сотрудника');
   if(restore&&r.group_id&&!one('SELECT id FROM live_groups WHERE id=?',r.group_id))fail(409,'Сначала восстановите группу');
  }
  if(table==='groups'&&!restore&&(one('SELECT id FROM live_users WHERE group_id=?',r.id)||one('SELECT id FROM teaching_assignments WHERE group_id=? AND active=1',r.id)||one('SELECT id FROM live_lessons WHERE grp=?',r.name)))fail(409,'В группе есть аккаунты, занятия или действующие назначения. Сначала перенесите или удалите их, закройте назначения');
  if(restore&&['clubs','events'].includes(table)&&!one('SELECT id FROM live_users WHERE id=?',r.owner))fail(409,'Сначала восстановите ответственного');
  if(restore&&table==='lessons'&&!one('SELECT id FROM live_groups WHERE name=?',r.grp))fail(409,'Сначала восстановите группу');
  if(restore&&table==='grades'&&!one('SELECT id FROM live_users WHERE id=?',r.user_id))fail(409,'Сначала восстановите студента');
 }
 function handle(p,method,b,u,send){
  if(p==='/api/trash'&&method==='GET'){
   if(!['admin','staff','manager','teacher'].includes(u.role))fail(403,'Нет доступа');
   send(tables.flatMap(table=>all(`SELECT * FROM ${table} WHERE deleted_at IS NOT NULL`).filter(r=>access(table,r,u)).map(r=>({table,id:r.id,label:r.name||r.title||r.subject,date:r.deleted_at}))));return true;
  }
  const m=p.match(/^\/api\/records\/(groups|users|lessons|clubs|events|grades)\/(delete|restore)$/);if(!m||method!=='POST')return false;
  const [,table,action]=m,r=one(`SELECT * FROM ${table} WHERE id=?`,Number(b.id)||0);if(!r||!access(table,r,u))fail(404,'Запись не найдена');const restore=action==='restore';if(restore?!r.deleted_at:!!r.deleted_at)fail(409,'Запись уже изменена');check(table,r,restore,u);
  const now=restore?null:new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
   run(`UPDATE ${table} SET deleted_at=? WHERE id=?`,now,r.id);
   if(table==='users'){run('DELETE FROM sessions WHERE user_id=?',r.id);if(one("SELECT name FROM sqlite_master WHERE type='table' AND name='mail_jobs'"))run("UPDATE mail_jobs SET state='cancelled',payload=NULL WHERE user_id=? AND state IN ('pending','sending')",r.id)}
   if(table==='grades'){run('INSERT INTO journal_history(actor,assignment_id,entity,record_id,old_json,new_json) VALUES(?,?,?,?,?,?)',u.id,r.assignment_id,'grades',r.id,JSON.stringify(r),JSON.stringify({...r,deleted_at:now}));run('INSERT INTO notices(user_id,title,body) VALUES(?,?,?)',r.user_id,restore?'Оценка восстановлена':'Оценка удалена',r.subject)}
   run('INSERT INTO audit(actor,action,entity,record_id) VALUES(?,?,?,?)',u.id,action,table,r.id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}send({ok:true});return true;
 }
 return {handle};
}
