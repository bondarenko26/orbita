import {TEMP_LIFETIME,temporaryPassword,uniqueLogin,passwordError} from './credentials.mjs';
import {installAcademic} from './academic.mjs';
// Administrative domain: explicit fields, validation and server-side ownership.
export function installManagement(db,ctx){
 const {hash,fail,required,allowed,date,time}=ctx;
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 const columns={users:{active:'INTEGER NOT NULL DEFAULT 1',subgroup:"TEXT NOT NULL DEFAULT ''"},lessons:{archived:'INTEGER NOT NULL DEFAULT 0',term_start:"TEXT NOT NULL DEFAULT '2026-09-01'",term_end:"TEXT NOT NULL DEFAULT '2027-01-31'",subgroup:"TEXT NOT NULL DEFAULT ''"},clubs:{archived:'INTEGER NOT NULL DEFAULT 0',enrollment_open:'INTEGER NOT NULL DEFAULT 1'},events:{archived:'INTEGER NOT NULL DEFAULT 0'}};
 db.exec(`CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor INTEGER REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,record_id INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,faculty TEXT NOT NULL,program TEXT NOT NULL,course INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),semester_start TEXT NOT NULL,semester_end TEXT NOT NULL,week_anchor TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS exceptions(id INTEGER PRIMARY KEY,lesson_id INTEGER NOT NULL REFERENCES lessons(id),original_date TEXT NOT NULL,new_date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,room TEXT NOT NULL,cancelled INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL,UNIQUE(lesson_id,original_date));
 CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),content TEXT NOT NULL,issued_by INTEGER NOT NULL REFERENCES users(id),created TEXT DEFAULT CURRENT_TIMESTAMP);`);
 for(const [table,cols]of Object.entries(columns))for(const [name,type]of Object.entries(cols))if(!all(`PRAGMA table_info(${table})`).some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
 run('INSERT OR IGNORE INTO settings VALUES(1,?,?,?)','','','');
 const academic=installAcademic(db,{fail,date});
 const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
 const choice=(name,label,options)=>field(name,label,'select',{options});
 const weekdays=[[1,'Понедельник'],[2,'Вторник'],[3,'Среда'],[4,'Четверг'],[5,'Пятница'],[6,'Суббота'],[0,'Воскресенье']];
 const active=choice('archived','Публикация',[[0,'Опубликовано'],[1,'Архив']]);
 const schemas={
 groups:{title:'Группы',roles:['admin','staff'],fields:[field('name','Название группы'),field('faculty','Факультет'),field('program','Направление'),field('course','Курс','number')]},
 users:{title:'Аккаунты',roles:['admin'],fields:[field('login','Логин'),field('name','ФИО'),choice('role','Роль',[['student','Студент'],['staff','Деканат'],['manager','Руководитель секций'],['admin','Администратор']]),field('grp','Группа','group',{optional:true}),field('subgroup','Подгруппа','text',{optional:true}),field('faculty','Факультет'),field('program','Направление'),field('course','Курс','number'),choice('active','Доступ',[[1,'Разрешён'],[0,'Заблокирован']]),field('password','Пароль: при создании обязателен; при редактировании пустое поле сохраняет прежний','password',{optional:true})]},
 lessons:{title:'Расписание',roles:['admin','staff'],fields:[field('grp','Группа','group'),field('subgroup','Подгруппа (пусто — вся группа)','text',{optional:true}),field('subject','Дисциплина'),choice('kind','Тип',['Лекция','Практика','Лабораторная','Экзамен','Зачёт','Консультация']),choice('day','День недели',weekdays),field('start','Начало','time'),field('end','Окончание','time'),field('room','Аудитория и корпус'),field('teacher','Преподаватель'),choice('parity','Повторение',[['all','Каждую неделю'],['odd','Нечётные недели'],['even','Чётные недели']]),field('date','Разовая дата (необязательно)','date',{optional:true}),field('term_start','Действует с','date'),field('term_end','Действует до','date'),active]},
 clubs:{title:'Кружки и секции',roles:['admin','manager'],fields:[field('title','Название'),choice('category','Направление',['Спорт','Творчество','Наука']),field('description','Описание','textarea'),field('place','Место'),choice('weekday','День недели',weekdays),field('start','Начало','time'),field('end','Окончание','time'),field('capacity','Количество мест','number'),field('owner','Ответственный','owner'),choice('enrollment_open','Набор',[[1,'Открыт'],[0,'Закрыт']]),active]},
 events:{title:'Сборные и соревнования',roles:['admin','manager'],fields:[field('title','Название'),choice('type','Тип',['Сборная','Соревнование']),field('date','Дата и время','datetime-local'),field('place','Место'),field('description','Описание, условия и результаты','textarea'),field('owner','Ответственный','owner'),active]},
 grades:{title:'Оценки',roles:['admin','staff'],fields:[field('user_id','Студент','student'),field('subject','Дисциплина'),choice('score','Результат',['2','3','4','5','Зачтено','Не зачтено']),choice('assessment','Аттестация',['Экзамен','Зачёт','Контрольная','Лабораторная']),field('date','Дата','date')]},
 notices:{title:'Объявления',roles:['admin','staff'],fields:[field('user_id','Получатель (пусто — всем)','student',{optional:true}),field('title','Заголовок'),field('body','Текст','textarea')]},
 settings:{title:'Учебный семестр',roles:['admin'],singleton:true,fields:[field('semester_start','Начало семестра','date'),field('semester_end','Конец семестра','date'),field('week_anchor','Понедельник первой учебной недели','date')]}
 };
 academic.extend(schemas);
 const audit=(u,action,entity,id)=>run('INSERT INTO audit(actor,action,entity,record_id) VALUES(?,?,?,?)',u.id,action,entity,id);
 const notify=(id,title,body)=>run('INSERT INTO notices(user_id,title,body) VALUES(?,?,?)',id,title,body);
 const forGroup=(l,title,body)=>{for(const s of all("SELECT id FROM users WHERE role='student' AND active=1 AND grp=? AND (?='' OR subgroup=?)",l.grp,l.subgroup||'',l.subgroup||''))notify(s.id,title,body)};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 const integer=(v,min,max)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail(400,'Проверьте числовое значение');return n};
 const numericIds=new Set(['user_id','owner','course','day','weekday','capacity','archived','enrollment_open','active','group_id','teacher_id','assignment_id','admission_year']);
 function owned(table,id,u){const row=one(`SELECT * FROM ${table} WHERE id=?`,id);if(!row||(['clubs','events'].includes(table)&&u.role!=='admin'&&row.owner!==u.id))fail(404,'Запись не найдена');return row}
 function validate(table,b,u,old){
 const schema=schemas[table],v={};for(const f of schema.fields){let x=b[f.name];if(f.name==='password'){if(x)v.password=hashPassword(x);else if(!old)fail(400,'Задайте пароль нового аккаунта');continue}
 if(f.name==='owner'&&u.role==='manager'){v.owner=u.id;continue}
 if(f.optional&&(x===''||x==null)){v[f.name]=['user_id','date','group_id','institute_id'].includes(f.name)?null:'';continue}
 if(x==null)fail(400,'Заполните поле «'+f.label+'»');x=String(x).trim();if(!x||x.length>(f.type==='textarea'?8000:200))fail(400,'Проверьте поле «'+f.label+'»');
 if(f.type==='select')allowed(x,f.options.map(o=>String(Array.isArray(o)?o[0]:o)));
 if(f.type==='date')date(x);if(f.type==='time')time(x);if(f.type==='datetime-local'){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x))fail(400,'Проверьте дату и время');date(x.slice(0,10));time(x.slice(11));}
 if(numericIds.has(f.name))x=integer(x,0,1000000);v[f.name]=x;
 }
 academic.validate(table,v,u,old);
 if(v.start&&v.end<=v.start)fail(400,'Окончание должно быть позже начала');
 if(v.term_start&&v.term_end<v.term_start||v.semester_start&&v.semester_end<v.semester_start)fail(400,'Конец периода раньше начала');
 if(table==='lessons'&&v.date&&(v.date<v.term_start||v.date>v.term_end))fail(400,'Дата занятия вне заданного периода');
 if(table==='settings'&&(new Date(v.week_anchor+'T12:00:00Z').getUTCDay()!==1||v.week_anchor>v.semester_start||Date.parse(v.semester_start)-Date.parse(v.week_anchor)>6*86400000))fail(400,'Укажите понедельник недели начала семестра');
 if(v.course!==undefined)integer(v.course,1,8);
 if(v.grp&&!one('SELECT id FROM groups WHERE name=?',v.grp))fail(400,'Сначала создайте группу в справочнике');
 if(table==='users'&&v.role==='student'&&!v.grp)fail(400,'Студенту нужна группа');
 if(table==='users'){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(v.login))fail(400,'Логин: 3–80 латинских букв, цифр, точек, дефисов или подчёркиваний');if(old?.id===u.id&&v.password)fail(400,'Свой пароль меняйте в профиле');if(!old||v.password){v.must_change_password=1;v.temporary_password_expires=Date.now()+TEMP_LIFETIME;}}
 if(v.owner&&!one("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('manager','admin')",v.owner))fail(400,'Выберите активного руководителя');
 if(table!=='staff_scopes'&&v.user_id&&!one("SELECT id FROM users WHERE id=? AND role='student'",v.user_id))fail(400,'Студент не найден');
 if(table==='clubs'){integer(v.capacity,1,1000);if(old&&one("SELECT count(*) n FROM memberships WHERE club_id=? AND status='Вы приняты'",old.id).n>v.capacity)fail(409,'Мест меньше, чем принятых участников');}
 if(table==='users'&&old){if(old.id===u.id&&(v.role!=='admin'||v.active!==1))fail(409,'Нельзя заблокировать себя или снять свою роль администратора');if(['admin','manager'].includes(old.role)&&(!['admin','manager'].includes(v.role)||!v.active)&&(one('SELECT id FROM clubs WHERE owner=? AND archived=0',old.id)||one('SELECT id FROM events WHERE owner=? AND archived=0',old.id)))fail(409,'Сначала передайте секции и события другому ответственному');}
 return v;
 }
 function hashPassword(x){const error=passwordError(x);if(error)fail(400,error);return hash(x)}
 function save(table,b,u){const schema=Object.hasOwn(schemas,table)?schemas[table]:null;if(!schema||!schema.roles.includes(u.role))fail(403,'Недостаточно прав');const id=b.id?integer(b.id,1,1000000):null,old=id?owned(table,id,u):null;if(schema.singleton&&id!==1)fail(400,'Редактируйте существующие настройки');let issued;if(table==='users'&&!old){b={...b,login:b.login||uniqueLogin(b.role,v=>one('SELECT id FROM users WHERE login=?',v)),password:b.password||temporaryPassword()}}if(table==='users'&&b.password)issued={name:b.name,login:b.login,password:b.password};const v=validate(table,b,u,old);return transaction(()=>{
 const keys=Object.keys(v);let recordId=id;if(old){run(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,...keys.map(k=>v[k]),id)}else{recordId=Number(run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>v[k])).lastInsertRowid)}
 if(table==='groups'&&old&&v.name!==old.name){run('UPDATE users SET grp=? WHERE grp=?',v.name,old.name);run('UPDATE lessons SET grp=? WHERE grp=?',v.name,old.name)}
 if(table==='users'&&old&&(v.password||v.role!==old.role||v.active!==old.active))run('DELETE FROM sessions WHERE user_id=?',id);
 if(table==='users'&&old&&v.password)run('DELETE FROM password_attempts WHERE user_id=?',id);
 if(table==='lessons'){forGroup(v,old?'Изменение расписания':'Новое занятие',`${v.subject}: ${v.start}–${v.end}, ${v.room}${v.archived?' · убрано из расписания':''}`);if(old&&old.grp!==v.grp)forGroup(old,'Изменение расписания',`${old.subject}: занятие переназначено другой группе`)}
 if(table==='clubs'&&old)for(const m of all('SELECT user_id FROM memberships WHERE club_id=?',id))notify(m.user_id,'Изменение в секции «'+v.title+'»',`${v.start}–${v.end}, ${v.place}${v.archived?' · секция в архиве':''}`);
 if(table==='grades')notify(v.user_id,'Обновлена успеваемость',`${v.subject}: ${v.score}`);
 if(table==='notices'&&old)run('DELETE FROM reads WHERE notice_id=?',id);
 academic.afterSave(table,v,old,recordId,u);
 audit(u,old?'update':'create',table,recordId);return {id:recordId,...(issued?{credentials:[{...issued,id:recordId,expires:v.temporary_password_expires}]}:{})};});}
 function calendar(d,u){const day=new Date(d+'T12:00:00Z').getUTCDay(),settings=one('SELECT * FROM settings WHERE id=1'),week=settings.week_anchor?Math.floor((Date.parse(d)-Date.parse(settings.week_anchor))/604800000)+1:null;
 let lessons=all(`SELECT l.*,n.text AS note FROM lessons l LEFT JOIN notes n ON n.lesson_id=l.id AND n.user_id=? AND n.date=? WHERE l.archived=0 AND l.grp=? AND (l.subgroup='' OR l.subgroup=?) AND ? BETWEEN l.term_start AND l.term_end AND ((l.date IS NULL AND l.day=? AND (l.parity='all' OR l.parity=?)) OR l.date=?) ORDER BY start`,u.id,d,u.grp,u.subgroup||'',d,day,week===null?'':week%2?'odd':'even',d);
 const exceptions=all(`SELECT x.* FROM exceptions x JOIN lessons l ON l.id=x.lesson_id WHERE l.archived=0 AND l.grp=? AND (l.subgroup='' OR l.subgroup=?) AND (x.original_date=? OR x.new_date=?)`,u.grp,u.subgroup||'',d,d);
 for(const x of exceptions){const index=lessons.findIndex(l=>l.id===x.lesson_id);if(x.original_date===d&&index>=0){const base=lessons[index];lessons[index]={...base,status:'cancelled',change:x.cancelled?'Отменено: '+x.reason:'Перенесено на '+x.new_date+' '+x.start+': '+x.reason};if(x.new_date===d&&!x.cancelled)lessons[index]={...base,start:x.start,end:x.end,room:x.room,change:`Было ${base.start}, ${base.room}. ${x.reason}`};}if(x.new_date===d&&x.original_date!==d&&!x.cancelled){const base=one('SELECT * FROM lessons WHERE id=?',x.lesson_id),note=one('SELECT text FROM notes WHERE user_id=? AND lesson_id=? AND date=?',u.id,x.lesson_id,d);lessons.push({...base,start:x.start,end:x.end,room:x.room,note:note?.text,change:'Перенос с '+x.original_date+': '+x.reason})}}
 lessons.sort((a,b)=>a.start.localeCompare(b.start));
 const clubs=all("SELECT c.* FROM clubs c JOIN memberships m ON m.club_id=c.id WHERE c.archived=0 AND m.user_id=? AND m.status='Вы приняты' AND c.weekday=?",u.id,day);return {lessons,clubs,week,settings};
 }
 async function handle(p,method,b,u,send){
 if(!p.startsWith('/api/manage'))return false;if(!['admin','staff','manager'].includes(u.role))fail(403,'Недостаточно прав');
 if(p==='/api/manage'&&method==='GET'){
 const entities={};for(const [name,s]of Object.entries(schemas))if(s.roles.includes(u.role)){let rows=['clubs','events'].includes(name)&&u.role==='manager'?all(`SELECT * FROM ${name} WHERE owner=? ORDER BY id DESC`,u.id):all(`SELECT * FROM ${name} ORDER BY id DESC`);rows=academic.filter(name,rows,u);const fields=s.fields.map(f=>u.role==='staff'&&name==='users'&&f.name==='role'?{...f,options:f.options.filter(o=>['student','teacher'].includes(o[0]))}:f);entities[name]={...s,fields,rows:rows.map(r=>{const {password,...safe}=r;return safe})}}
 const students=['admin','staff'].includes(u.role)?academic.filter('users',all("SELECT * FROM users WHERE role='student' ORDER BY name"),u).map(({id,name,grp,group_id,subgroup})=>({id,name,grp,group_id,subgroup})):[];
 send({entities,...academic.meta(u),settings:one('SELECT * FROM settings WHERE id=1'),groups:academic.filter('groups',all('SELECT * FROM groups ORDER BY name'),u),students,owners:u.role==='admin'?all("SELECT id,name FROM users WHERE active=1 AND role IN ('manager','admin')"):[{id:u.id,name:u.name}],requests:['admin','staff'].includes(u.role)?academic.filter('requests',all('SELECT r.*,u.name,d.content AS document FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN documents d ON d.request_id=r.id ORDER BY r.id DESC'),u):[],memberships:all("SELECT m.*,u.name,c.title FROM memberships m JOIN clubs c ON c.id=m.club_id JOIN users u ON u.id=m.user_id WHERE c.owner=? OR ?='admin'",u.id,u.role),audit:u.role==='admin'?all('SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC LIMIT 100'):[],exceptions:['admin','staff'].includes(u.role)?academic.filter('exceptions',all('SELECT x.*,l.subject,l.grp FROM exceptions x JOIN lessons l ON l.id=x.lesson_id ORDER BY x.original_date DESC'),u):[]});return true;
 }
 if(method!=='POST')return false;
 const entity=p.slice('/api/manage/'.length);if(Object.hasOwn(schemas,entity)){send(save(entity,b,u));return true}
 if(entity==='exceptions'){
 if(!['admin','staff'].includes(u.role))fail(403,'Недостаточно прав');const l=one('SELECT * FROM lessons WHERE id=? AND archived=0',Number(b.lesson_id));if(!l||!academic.filter('lessons',[l],u).length)fail(404,'Занятие не найдено');const original=date(b.original_date),target=date(b.new_date||b.original_date),start=time(b.start),end=time(b.end),room=required(b,'room',200),reason=required(b,'reason',200),cancelled=integer(b.cancelled,0,1);if(end<=start)fail(400,'Проверьте время');const candidate=calendar(original,{id:-1,grp:l.grp,subgroup:l.subgroup}).lessons.find(x=>x.id===l.id);if(!candidate)fail(400,'На исходную дату нет выбранного занятия');if(target<l.term_start||target>l.term_end)fail(400,'Новая дата вне периода занятия');
 transaction(()=>{run('INSERT INTO exceptions(lesson_id,original_date,new_date,start,end,room,cancelled,reason) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id,original_date) DO UPDATE SET new_date=excluded.new_date,start=excluded.start,end=excluded.end,room=excluded.room,cancelled=excluded.cancelled,reason=excluded.reason',l.id,original,target,start,end,room,cancelled,reason);forGroup(l,'Изменение занятия',`${l.subject} · ${original}: ${cancelled?'отменено':'перенесено на '+target+' '+start+', '+room}. ${reason}`);audit(u,'exception','lessons',l.id)});send({ok:true});return true;
 }
 if(entity==='requests'){
 if(!['admin','staff'].includes(u.role))fail(403,'Недостаточно прав');const r=one('SELECT * FROM requests WHERE id=?',Number(b.id));if(!r||!academic.canStudent(u,r.user_id))fail(404,'Заявка не найдена');const status=allowed(b.status,['Принята','В работе','Нужно уточнение','Готова']),reply=String(b.reply||'').slice(0,2000),document=String(b.document||'').trim();if(document.length>10000)fail(400,'Документ слишком длинный');if(status==='Готова'&&r.type!=='Заявление в деканат'&&!document)fail(400,'Добавьте текст готовой справки');transaction(()=>{run('UPDATE requests SET status=?,reply=? WHERE id=?',status,reply,r.id);if(document)run('INSERT INTO documents(request_id,content,issued_by) VALUES(?,?,?) ON CONFLICT(request_id) DO UPDATE SET content=excluded.content,issued_by=excluded.issued_by,created=CURRENT_TIMESTAMP',r.id,document,u.id);notify(r.user_id,'Заявка №'+r.id+': '+status,reply);audit(u,'status','requests',r.id)});send({ok:true});return true;
 }
 if(entity==='memberships'){
 if(!['admin','manager'].includes(u.role))fail(403,'Недостаточно прав');const m=one('SELECT m.*,c.owner,c.capacity,c.archived FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.id=?',Number(b.id));if(!m||u.role!=='admin'&&m.owner!==u.id)fail(404,'Запись не найдена');const status=allowed(b.status,['Вы приняты','На рассмотрении','Набор закрыт']);transaction(()=>{if(status==='Вы приняты'&&m.archived)fail(409,'Секция в архиве');if(status==='Вы приняты'&&m.status!==status&&one("SELECT count(*) n FROM memberships WHERE club_id=? AND status='Вы приняты'",m.club_id).n>=m.capacity)fail(409,'Мест нет');run('UPDATE memberships SET status=? WHERE id=?',status,m.id);notify(m.user_id,'Запись в секцию',status);audit(u,'status','memberships',m.id)});send({ok:true});return true;
 }
 return false;
 }
 return {handle,calendar,academic};
}
