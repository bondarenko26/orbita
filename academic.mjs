import {liveSql} from './deletion.mjs';
import {readFileSync} from 'node:fs';
export function installAcademic(db,{fail,date}){
 const all=(s,...p)=>db.prepare(liveSql(s)).all(...p),one=(s,...p)=>db.prepare(liveSql(s)).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 db.exec(`CREATE TABLE IF NOT EXISTS academic_nodes(id TEXT PRIMARY KEY,parent_id TEXT,kind TEXT,name TEXT,code TEXT,status TEXT);
 CREATE TABLE IF NOT EXISTS academic_imports(id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS staff_scopes(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),institute_id TEXT REFERENCES academic_nodes(id),UNIQUE(user_id,institute_id));
 CREATE TABLE IF NOT EXISTS teaching_assignments(id INTEGER PRIMARY KEY,teacher_id INTEGER REFERENCES users(id),group_id INTEGER REFERENCES groups(id),subgroup TEXT DEFAULT '',subject TEXT NOT NULL,semester TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY,assignment_id INTEGER REFERENCES teaching_assignments(id),lesson_id INTEGER REFERENCES lessons(id),user_id INTEGER REFERENCES users(id),date TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(lesson_id,user_id,date));
 CREATE TABLE IF NOT EXISTS journal_history(id INTEGER PRIMARY KEY,actor INTEGER REFERENCES users(id),assignment_id INTEGER REFERENCES teaching_assignments(id),entity TEXT,record_id INTEGER,old_json TEXT,new_json TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
 const additions={teaching_assignments:{from_schedule:'INTEGER NOT NULL DEFAULT 0'},groups:{program_id:'TEXT REFERENCES academic_nodes(id)',institute_id:'TEXT REFERENCES academic_nodes(id)',admission_year:'INTEGER'},users:{group_id:'INTEGER REFERENCES groups(id)',institute_id:'TEXT REFERENCES academic_nodes(id)'},lessons:{assignment_id:'INTEGER REFERENCES teaching_assignments(id)'},grades:{assignment_id:'INTEGER REFERENCES teaching_assignments(id)'},notices:{institute_id:'TEXT REFERENCES academic_nodes(id)'}};
 for(const [table,fields]of Object.entries(additions))for(const [name,type]of Object.entries(fields))if(!all(`PRAGMA table_info(${table})`).some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
 if(!one('SELECT id FROM academic_imports WHERE id=?','mgsu-v1')){
 const ref=JSON.parse(readFileSync(new URL('./reference/mgsu_structure.json',import.meta.url),'utf8'));
 const walk=(n,kind,parent)=>{run('INSERT OR IGNORE INTO academic_nodes VALUES(?,?,?,?,?,?)',n.id,parent,kind,n.name,n.code||n.abbreviation||'',n.status||'reference');for(const [key,next]of [['education_forms','form'],['levels','level'],['directions','direction'],['programs','program']])for(const child of n[key]||[])walk({...child,id:child.id||n.id+'__'+child.code},next,n.id)};
 db.exec('BEGIN');try{for(const n of ref.institutes)walk(n,'institute',null);for(const n of ref.additional_navigation)walk(n,'institute',null);run('INSERT INTO academic_imports VALUES(?)','mgsu-v1');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 }
 // Link existing records only; never create students, groups or lessons in migrations.
 run("UPDATE users SET group_id=(SELECT id FROM groups WHERE name=users.grp) WHERE role='student' AND group_id IS NULL AND grp<>''");
 const catalog=()=>all('SELECT * FROM academic_nodes');
 function pathOf(id){const result=[];let node=one('SELECT * FROM academic_nodes WHERE id=?',id||'');while(node){result.unshift(node);node=one('SELECT * FROM academic_nodes WHERE id=?',node.parent_id||'')}return result}
 if(!all('PRAGMA table_info(staff_scopes)').some(c=>c.name==='active'))db.exec('ALTER TABLE staff_scopes ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
 const scopes=u=>u.role==='admin'?all("SELECT id FROM academic_nodes WHERE kind='institute'").map(n=>n.id):all('SELECT institute_id FROM staff_scopes WHERE user_id=? AND active=1',u.id).map(n=>n.institute_id);
 const allowedInstitute=(u,id)=>u.role==='admin'||u.role==='staff'&&!!id&&scopes(u).includes(id);
 const group=id=>one('SELECT * FROM groups WHERE id=?',Number(id)||0);
 const effectiveInstitute=u=>u.role==='student'?group(u.group_id)?.institute_id:u.institute_id;
 const canStudent=(u,id)=>{const s=one("SELECT * FROM users WHERE id=? AND role='student'",Number(id)||0);return !!s&&allowedInstitute(u,effectiveInstitute(s))};
 const assignment=id=>one('SELECT * FROM teaching_assignments WHERE id=?',Number(id)||0);
 function canAssignment(u,a){return !!a&&(u.role==='admin'||u.role==='staff'&&allowedInstitute(u,group(a.group_id)?.institute_id)||u.role==='teacher'&&a.active===1&&a.teacher_id===u.id)}
 function filter(table,rows,u){if(u.role==='admin')return rows;if(u.role!=='staff')return rows;return rows.filter(r=>{
 if(table==='groups')return allowedInstitute(u,r.institute_id);
 if(table==='users')return ['student','teacher'].includes(r.role)&&allowedInstitute(u,effectiveInstitute(r));
 if(table==='teaching_assignments')return canAssignment(u,r);
 if(table==='lessons')return allowedInstitute(u,(r.assignment_id?group(assignment(r.assignment_id)?.group_id):one('SELECT * FROM groups WHERE name=?',r.grp))?.institute_id);
 if(['grades','requests'].includes(table))return canStudent(u,r.user_id);
 if(table==='exceptions'){const l=one('SELECT * FROM lessons WHERE id=?',r.lesson_id);return l&&filter('lessons',[l],u).length>0}
 if(table==='notices')return r.user_id?canStudent(u,r.user_id):allowedInstitute(u,r.institute_id);
 return false;
 })}
 const field=(name,label,type='text',optional=false)=>({name,label,type,optional});
 const choice=(name,label,options)=>({name,label,type:'select',options});
 function extend(s){
 s.groups.fields=[field('name','Название группы'),field('program_id','Образовательная программа МГСУ','program_path'),field('course','Курс','number'),field('admission_year','Год поступления','number')];
 s.users.roles=['admin','staff'];s.users.fields=[field('login','Email — логин','text'),field('name','ФИО'),choice('role','Роль',[['student','Студент'],['teacher','Преподаватель'],['staff','Деканат'],['manager','Руководитель секций'],['admin','Администратор']]),field('group_id','Группа (для студента)','group_id',true),field('subgroup','Подгруппа (если есть)','text',true),field('institute_id','Институт (для преподавателя)','institute',true),choice('active','Доступ',[[1,'Разрешён'],[0,'Заблокирован']]),field('password','Пароль: пусто при создании — сгенерировать; при редактировании — сохранить','password',true)];
 s.lessons.fields=[
  field('group_id','Группа','group_id'),field('subgroup','Подгруппа (пусто — вся группа)','text',true),
  field('subject','Дисциплина'),field('teacher_id','Преподаватель','teacher_search'),
  ...s.lessons.fields.filter(f=>!['grp','subgroup','subject','teacher'].includes(f.name))
 ];
 s.grades.fields=s.grades.fields.filter(f=>f.name!=='subject');s.grades.fields.unshift(field('assignment_id','Преподаватель, дисциплина и группа','assignment'));
 s.notices.fields.push(field('institute_id','Институт получателей (пусто — весь вуз, только для администратора)','institute',true));
 s.staff_scopes={title:'Права деканата',roles:['admin'],fields:[field('user_id','Сотрудник деканата','staff'),field('institute_id','Институт','institute'),choice('active','Доступ',[[1,'Разрешён'],[0,'Отозван']])]};
 s.teaching_assignments={title:'Назначения преподавателей',roles:['admin','staff'],fields:[field('teacher_id','Преподаватель','teacher'),field('group_id','Группа','group_id'),field('subgroup','Подгруппа (пусто — вся группа)','text',true),field('subject','Дисциплина'),field('semester','Учебный год и семестр'),field('start_date','Действует с','date'),field('end_date','Действует до','date'),choice('active','Назначение',[[1,'Действует'],[0,'Закрыто']])]};
 }
 // Resolve the journal link in the same transaction as the lesson.
 function lessonAssignment(v,u,old) {
  const g=group(v.group_id);
  if(!g?.program_id) fail(400,'Выберите группу МГСУ');
  if(!allowedInstitute(u,g.institute_id)) fail(403,'Нет доступа к группе');
  if(!one("SELECT id FROM users WHERE id=? AND role='teacher' AND active=1",v.teacher_id)) fail(400,'Выберите действующего преподавателя из списка');
  const key=[v.teacher_id,g.id,v.subgroup,v.subject];
  const found=one(`SELECT id FROM teaching_assignments
   WHERE teacher_id=? AND group_id=? AND subgroup=? AND subject=?
   AND (active=1 OR from_schedule=1) AND start_date<=? AND end_date>=?
   ORDER BY (id=?) DESC, active DESC, from_schedule, start_date DESC, id LIMIT 1`,
   ...key,v.term_start,v.term_end,old?.assignment_id||0);
  if(found) return found.id;
  const term=one('SELECT semester_start,semester_end FROM settings WHERE id=1');
  const withinTerm=term?.semester_start && term.semester_start<=v.term_start && term.semester_end>=v.term_end;
  const start=withinTerm?term.semester_start:v.term_start, end=withinTerm?term.semester_end:v.term_end;
  return Number(run(`INSERT INTO teaching_assignments(teacher_id,group_id,subgroup,subject,semester,start_date,end_date,from_schedule)
   VALUES(?,?,?,?,?,?,?,1)`,...key,start+' — '+end,start,end).lastInsertRowid);
 }
 function syncLessonAssignment(id) {
  if(id) run(`UPDATE teaching_assignments SET active=EXISTS(
   SELECT 1 FROM live_lessons WHERE assignment_id=? AND archived=0)
   WHERE id=? AND from_schedule=1`,id,id);
 }
 function validate(table,v,u,old){
 if(old&&u.role==='staff'&&!filter(table,[old],u).length)fail(404,'Запись не найдена');
 if(table==='groups'){const p=pathOf(v.program_id);if(p.at(-1)?.kind!=='program')fail(400,'Выберите программу из структуры МГСУ');v.institute_id=p[0].id;if(!allowedInstitute(u,v.institute_id))fail(403,'Нет доступа к институту');v.faculty=p[0].name;v.program=p.at(-1).name;if(!Number.isInteger(v.admission_year)||v.admission_year<1990||v.admission_year>2100)fail(400,'Проверьте год поступления');}
 if(table==='users'){
 if(u.role==='staff'&&!['student','teacher'].includes(v.role))fail(403,'Деканат создаёт только студентов и преподавателей');
 if(old&&old.role!==v.role&&(one('SELECT id FROM teaching_assignments WHERE teacher_id=? AND active=1',old.id)))fail(409,'Сначала закройте назначения преподавателя');
 if(v.role==='student'){const g=group(v.group_id);if(!g||!g.program_id)fail(400,'Выберите группу с программой МГСУ');if(!allowedInstitute(u,g.institute_id))fail(403,'Нет доступа к группе');v.grp=g.name;v.faculty=g.faculty;v.program=g.program;v.course=g.course;v.institute_id=g.institute_id;}
 else {v.group_id=null;v.grp='';v.faculty='';v.program='';v.course=1;v.subgroup='';if(v.institute_id&&one('SELECT kind FROM academic_nodes WHERE id=?',v.institute_id)?.kind!=='institute')fail(400,'Институт не найден');if(v.role==='teacher'&&!v.institute_id)fail(400,'Укажите институт преподавателя');if(u.role==='staff'&&!allowedInstitute(u,v.institute_id))fail(403,'Нет доступа к институту');}
 }
 if(table==='staff_scopes'){if(one('SELECT role FROM users WHERE id=?',v.user_id)?.role!=='staff')fail(400,'Выберите сотрудника деканата');if(one('SELECT kind FROM academic_nodes WHERE id=?',v.institute_id)?.kind!=='institute')fail(400,'Выберите институт');}
 if(table==='teaching_assignments'){
 if(old?.from_schedule)fail(409,'Это назначение изменяется в расписании');
 const g=group(v.group_id),t=one("SELECT * FROM users WHERE id=? AND role='teacher' AND active=1",v.teacher_id);if(!g?.program_id||!t)fail(400,'Выберите группу МГСУ и активного преподавателя');if(!allowedInstitute(u,g.institute_id))fail(403,'Назначение вне вашего института');if(v.end_date<v.start_date)fail(400,'Проверьте период назначения');if(old&&(old.teacher_id!==v.teacher_id||old.group_id!==v.group_id||old.subject!==v.subject||old.subgroup!==v.subgroup||old.start_date!==v.start_date||old.end_date!==v.end_date)&& (one('SELECT id FROM grades WHERE assignment_id=?',old.id)||one('SELECT id FROM lessons WHERE assignment_id=?',old.id)||one('SELECT id FROM attendance WHERE assignment_id=?',old.id)))fail(409,'Назначение уже используется. Закройте его и создайте новое, чтобы сохранить историю');
 }
 if(['lessons','grades'].includes(table)){
 const direct=table==='lessons' && v.teacher_id!==undefined;
 if(direct){
  v.assignment_id=lessonAssignment(v,u,old);
  delete v.teacher_id;
  delete v.group_id;
 }
 if(table==='lessons' && old?.assignment_id && old.assignment_id!==v.assignment_id && one('SELECT id FROM attendance WHERE lesson_id=?',old.id))
  fail(409,'По занятию уже отмечена посещаемость. Для другого назначения создайте отдельную пару');
 const a=assignment(v.assignment_id);if(!a||(!a.active&&!(direct&&a.from_schedule))||!canAssignment(u,a))fail(403,'Выберите доступное действующее назначение');const g=group(a.group_id);
 if(table==='lessons'){v.grp=g.name;v.subgroup=a.subgroup;v.subject=a.subject;const teacher=one("SELECT name FROM users WHERE id=? AND active=1 AND role='teacher'",a.teacher_id);if(!teacher)fail(400,'Выберите действующего преподавателя');v.teacher=teacher.name;if(v.term_start<a.start_date||v.term_end>a.end_date)fail(400,'Занятие выходит за срок назначения');}
 else {if(old&&(old.user_id!==v.user_id||old.assignment_id!==v.assignment_id))fail(400,'Нельзя переносить оценку другому студенту или назначению');checkStudent(a,v.user_id,v.date);v.subject=a.subject;}
 }
 if(table==='notices'&&u.role==='staff'){if(v.user_id){if(!canStudent(u,v.user_id))fail(403,'Получатель вне вашего института')}else if(!allowedInstitute(u,v.institute_id))fail(403,'Выберите свой институт для объявления');}
 }
 function afterSave(table,v,old,id,u){
 if(table==='lessons'){syncLessonAssignment(v.assignment_id);if(old?.assignment_id!==v.assignment_id)syncLessonAssignment(old?.assignment_id)}
 if(table==='groups')run('UPDATE users SET faculty=?,program=?,course=?,institute_id=?,grp=? WHERE group_id=?',v.faculty,v.program,v.course,v.institute_id,v.name,id);if(table==='grades')history(u,v.assignment_id,'grades',id,old,{...v,id});}
 function history(u,aid,entity,id,old,next){run('INSERT INTO journal_history(actor,assignment_id,entity,record_id,old_json,new_json) VALUES(?,?,?,?,?,?)',u.id,aid,entity,id,old?JSON.stringify(old):null,JSON.stringify(next))}
 function checkStudent(a,id,d){date(d);if(d<a.start_date||d>a.end_date)fail(400,'Дата вне периода назначения');const s=one("SELECT * FROM users WHERE id=? AND role='student' AND active=1",Number(id)||0);if(!s||s.group_id!==a.group_id||a.subgroup&&a.subgroup!==s.subgroup)fail(403,'Студент не входит в назначенную группу или подгруппу');return s}
 function me(u){const {password,...safe}=u,g=group(u.group_id);return {...safe,grp:g?.name||u.grp,course:g?.course||u.course,education:g?pathOf(g.program_id).map(n=>({kind:n.kind,name:n.name})):[],staff_institutes:u.role==='staff'?scopes(u).map(id=>pathOf(id)[0]?.name).filter(Boolean):[]}}
 const meta=u=>({catalog:catalog(),scopes:scopes(u),teachers:['admin','staff'].includes(u.role)?all("SELECT u.id,u.name,n.name AS institute FROM users u LEFT JOIN academic_nodes n ON n.id=u.institute_id WHERE u.role='teacher' AND u.active=1 ORDER BY u.name,u.id"):[],staff:u.role==='admin'?all("SELECT id,name FROM users WHERE role='staff'"):[],assignments:['admin','staff'].includes(u.role)?filter('teaching_assignments',all('SELECT a.*,u.name AS teacher_name,g.name AS group_name FROM teaching_assignments a JOIN users u ON u.id=a.teacher_id JOIN groups g ON g.id=a.group_id'),u):[]});
 function calendar(d,u,baseCalendar){const assignments=all('SELECT * FROM teaching_assignments WHERE teacher_id=? AND active=1 AND ? BETWEEN start_date AND end_date',u.id,d);const lessons=[];for(const a of assignments){const g=group(a.group_id);for(const l of baseCalendar(d,{id:u.id,grp:g.name,subgroup:a.subgroup}).lessons)if(l.assignment_id===a.id&&!lessons.some(x=>x.id===l.id))lessons.push({...l,group_name:g.name})}return {...baseCalendar(d,{id:u.id,grp:'',subgroup:''}),lessons:lessons.sort((a,b)=>a.start.localeCompare(b.start))}}
 async function handle(p,method,b,u,send,url,baseCalendar){
 if(p==='/api/attendance'&&method==='GET'){send(all('SELECT a.*,t.subject FROM attendance a JOIN teaching_assignments t ON t.id=a.assignment_id WHERE a.user_id=? ORDER BY a.date DESC',u.id));return true}
 if(!p.startsWith('/api/teaching'))return false;if(!['teacher','admin','staff'].includes(u.role))fail(403,'Нет доступа к журналу');
 if(p==='/api/teaching'&&method==='GET'){const rows=all('SELECT a.*,g.name AS group_name,u.name AS teacher_name FROM teaching_assignments a JOIN groups g ON g.id=a.group_id JOIN users u ON u.id=a.teacher_id').filter(a=>canAssignment(u,a));send({assignments:rows});return true}
 const aid=Number(method==='GET'?url.searchParams.get('assignment'):b.assignment_id),a=assignment(aid);if(!canAssignment(u,a))fail(404,'Назначение не найдено');
 if(p==='/api/teaching/journal'&&method==='GET'){
 const d=date(url.searchParams.get('date')||''),g=group(a.group_id);const students=all("SELECT id,name,subgroup FROM users WHERE role='student' AND active=1 AND group_id=? AND (?='' OR subgroup=?) ORDER BY name",a.group_id,a.subgroup,a.subgroup),ids=new Set(students.map(s=>s.id));
 const lessons=baseCalendar(d,{id:u.id,grp:g.name,subgroup:a.subgroup}).lessons.filter(l=>l.assignment_id===a.id&&l.status!=='cancelled');
 const historyRows=all(`SELECT h.*,coalesce(u.name,'Удалённый аккаунт') AS actor_name
  FROM journal_history h LEFT JOIN history_users u ON u.id=h.actor
  WHERE h.assignment_id=? ORDER BY h.id DESC LIMIT 100`,aid);
 send({assignment:a,students,lessons,grades:all('SELECT * FROM grades WHERE assignment_id=? ORDER BY date DESC,id DESC',aid).filter(r=>ids.has(r.user_id)),attendance:all('SELECT * FROM attendance WHERE assignment_id=? AND date=?',aid,d).filter(r=>ids.has(r.user_id)),history:historyRows.filter(r=>ids.has(JSON.parse(r.new_json).user_id))});return true;
 }
 if(method==='POST'&&['/api/teaching/grade','/api/teaching/attendance'].includes(p)){
 const sid=Number(b.user_id),d=date(b.date);checkStudent(a,sid,d);if(!a.active)fail(403,'Назначение закрыто');let old=null,next,entity,id;
 if(p.endsWith('/grade')){entity='grades';if(!['2','3','4','5','Зачтено','Не зачтено'].includes(b.score)||!['Экзамен','Зачёт','Контрольная','Лабораторная'].includes(b.assessment))fail(400,'Проверьте оценку и тип работы');old=b.id?one('SELECT * FROM grades WHERE id=?',Number(b.id)):null;if(b.id&&(!old||old.assignment_id!==aid||old.user_id!==sid))fail(404,'Оценка не найдена');next={assignment_id:aid,user_id:sid,subject:a.subject,score:b.score,assessment:b.assessment,date:d};}
 else {entity='attendance';const g=group(a.group_id),lesson=baseCalendar(d,{id:u.id,grp:g.name,subgroup:a.subgroup}).lessons.find(l=>l.id===Number(b.lesson_id)&&l.assignment_id===aid&&l.status!=='cancelled');if(!lesson)fail(400,'На выбранную дату нет этого занятия');if(!['Не отмечено','Присутствовал','Отсутствовал','Опоздал','Уважительная причина'].includes(b.status))fail(400,'Проверьте отметку');old=one('SELECT * FROM attendance WHERE lesson_id=? AND user_id=? AND date=?',lesson.id,sid,d);next={assignment_id:aid,lesson_id:lesson.id,user_id:sid,date:d,status:b.status};}
 db.exec('BEGIN IMMEDIATE');try{const keys=Object.keys(next);if(old){id=old.id;run(`UPDATE ${entity} SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,...keys.map(k=>next[k]),id)}else id=Number(run(`INSERT INTO ${entity}(${keys}) VALUES(${keys.map(()=>'?')})`,...keys.map(k=>next[k])).lastInsertRowid);history(u,aid,entity,id,old,{...next,id});if(entity==='grades')run('INSERT INTO notices(user_id,title,body,destination) VALUES(?,?,?,?)',sid,'Обновлена успеваемость',a.subject+': '+next.score,'grades');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send({id});return true;
 }
 return false;
 }
 return {extend,validate,afterSave,syncLessonAssignment,filter,meta,me,handle,calendar,canStudent,effectiveInstitute,allowedInstitute,scopes};
}
