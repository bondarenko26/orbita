import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const dir=process.env.DATA_DIR||path.join(root,'data'); mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'orbita.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,login TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,faculty TEXT,program TEXT,course INTEGER,grp TEXT,theme TEXT DEFAULT 'dark');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY,grp TEXT,day INTEGER,start TEXT,end TEXT,subject TEXT,kind TEXT,room TEXT,teacher TEXT,parity TEXT DEFAULT 'all',date TEXT,status TEXT DEFAULT 'scheduled',change TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS notes(user_id INTEGER REFERENCES users(id),lesson_id INTEGER REFERENCES lessons(id),date TEXT,text TEXT,PRIMARY KEY(user_id,lesson_id,date));
CREATE TABLE IF NOT EXISTS grades(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),subject TEXT,score TEXT,assessment TEXT,date TEXT);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),type TEXT,comment TEXT,status TEXT DEFAULT 'Принята',reply TEXT DEFAULT '',created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS clubs(id INTEGER PRIMARY KEY,title TEXT,category TEXT,description TEXT,place TEXT,weekday INTEGER,start TEXT,end TEXT,owner INTEGER REFERENCES users(id),capacity INTEGER DEFAULT 20);
CREATE TABLE IF NOT EXISTS memberships(id INTEGER PRIMARY KEY,club_id INTEGER REFERENCES clubs(id),user_id INTEGER REFERENCES users(id),status TEXT DEFAULT 'На рассмотрении',UNIQUE(club_id,user_id));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,title TEXT,type TEXT,date TEXT,place TEXT,description TEXT,owner INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),title TEXT,body TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reads(user_id INTEGER REFERENCES users(id),notice_id INTEGER REFERENCES notices(id),PRIMARY KEY(user_id,notice_id));`);
const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex')};
const verify=(p,h)=>{const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex'))};
const all=(sql,...v)=>db.prepare(sql).all(...v); const one=(sql,...v)=>db.prepare(sql).get(...v);const run=(sql,...v)=>db.prepare(sql).run(...v);
function seed(){
 if(one('SELECT id FROM users LIMIT 1'))return;
 const accounts=[['student1','Алиса Примерова','student','ИС-201'],['student2','Марк Вымышленный','student','ДЗ-202'],['staff','Вера Демонстрационная','staff',''],['coach','Илья Учебный','manager',''],['admin','Администратор прототипа','admin','']];
 const credentials=[];
 for(const [login,name,role,grp] of accounts){const password=randomBytes(9).toString('base64url');run('INSERT INTO users(login,password,name,role,faculty,program,course,grp) VALUES(?,?,?,?,?,?,?,?)',login,hash(password),name,role,'Институт цифровых технологий',grp==='ДЗ-202'?'Дизайн':'Информационные системы',2,grp);credentials.push({login,password,role});}
 for(const grp of ['ИС-201','ДЗ-202'])for(let day=1;day<=6;day++)for(const [i,start,end] of [[0,'09:00','10:20'],[1,'11:30','12:50'],[2,'14:30','15:50']])run('INSERT INTO lessons(grp,day,start,end,subject,kind,room,teacher) VALUES(?,?,?,?,?,?,?,?)',grp,day,start,end,(grp==='ДЗ-202'?['История дизайна','Композиция','Типографика']:['Программирование','Физическая культура и спорт','История России'])[(i+day-1)%3],['Лекция','Практика','Лабораторная'][i],['203 · Корпус А','Спортивный зал','304 · Корпус Б'][i],['А. А. Учебный','М. С. Примерная','И. В. Демонстрационный'][i]);
 for(let u=1;u<=2;u++)for(const [i,s] of ['Математика','Иностранный язык','Программирование','История России'].entries())run('INSERT INTO grades(user_id,subject,score,assessment,date) VALUES(?,?,?,?,?)',u,s,String(3+(i+u)%3),i%2?'Зачёт':'Экзамен','2026-12-'+(14+i));
 run('INSERT INTO clubs(title,category,description,place,weekday,start,end,owner,capacity) VALUES(?,?,?,?,?,?,?,?,?)','Волейбол','Спорт','Командная игра, тренировки и подготовка к студенческой лиге. Подходит начинающим.','Спортивный корпус · зал 2',2,'18:00','19:30',4,16);
 run('INSERT INTO clubs(title,category,description,place,weekday,start,end,owner,capacity) VALUES(?,?,?,?,?,?,?,?,?)','Мастерская дизайна','Творчество','Создаём плакаты, обсуждаем визуальные идеи и собираем портфолио.','Корпус Б · 110',4,'17:00','18:30',4,20);
 run('INSERT INTO clubs(title,category,description,place,weekday,start,end,owner,capacity) VALUES(?,?,?,?,?,?,?,?,?)','Робототехника','Наука','От первого датчика до собственного робота. Практические занятия в команде.','Лаборатория 305',3,'17:30','19:00',4,12);
 run('INSERT INTO events(title,type,date,place,description,owner) VALUES(?,?,?,?,?,?)','Сборная по волейболу','Сборная','2026-11-17T18:00','Спортивный корпус','Открытый просмотр: возьмите спортивную форму. Отбор после пробной тренировки.',4);
 run('INSERT INTO events(title,type,date,place,description,owner) VALUES(?,?,?,?,?,?)','Кубок кампуса','Соревнование','2026-11-24T16:00','Главный спортивный зал','Межфакультетский турнир. Регистрация команд через руководителя секции.',4);
 run('INSERT INTO notices(title,body) VALUES(?,?)','Добро пожаловать в Орбиту','Это конкурсный прототип. Все люди, оценки и события вымышлены.');
 run('INSERT INTO notices(user_id,title,body) VALUES(?,?,?)',1,'Приём заявок на справки','Закажите справку онлайн в разделе «Заявки».');
 console.log('Первый запуск: сохраните тестовые учётные данные. Они больше не будут показаны.\n'+JSON.stringify(credentials,null,2));
}
seed();
const safeUser=u=>{const {password,...v}=u;return v};
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
const limits=new Map();
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const required=(b,k,max=500)=>{if(typeof b[k]!=='string'||!b[k].trim()||b[k].length>max)fail(400,'Проверьте поле «'+k+'»');return b[k].trim()};
const allowed=(v,values)=>{if(!values.includes(v))fail(400,'Недопустимое значение');return v};
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'Неверная дата');return v}
function time(v){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))fail(400,'Неверное время');return v}
const roles=(u,...r)=>{if(!r.includes(u.role))fail(403,'Недостаточно прав')};
const notify=(uid,title,body)=>run('INSERT INTO notices(user_id,title,body) VALUES(?,?,?)',uid,title,body);
async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');const p=url.pathname;
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
 if(!p.startsWith('/api/')){const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!files[p])fail(404,'Не найдено');res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(readFileSync(path.join(root,'public',files[p])));return;}
 let b={};if(!['GET','HEAD'].includes(req.method)){const origin=req.headers.origin;if(origin&&origin!==(process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`))fail(403,'Источник запроса не разрешён');if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'Ожидается JSON');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)fail(413,'Слишком большой запрос')}try{b=JSON.parse(raw||'{}')}catch{fail(400,'Некорректный JSON')}}
 const cookie=req.headers.cookie?.match(/(?:^|; )orbita=([a-f0-9]{64})(?:;|$)/)?.[1];
 const u=cookie?one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',tokenHash(cookie),Date.now()):null;
 if(p==='/api/login'&&req.method==='POST'){
 const ip=req.socket.remoteAddress;let l=limits.get(ip);if(!l||l.until<Date.now())limits.set(ip,l={n:0,until:Date.now()+900000});if(++l.n>20)fail(429,'Слишком много попыток. Повторите через 15 минут.');
 const login=required(b,'login',80),password=required(b,'password',200);const user=one('SELECT * FROM users WHERE login=?',login);if(!user||!verify(password,user.password))fail(401,'Неверный логин или пароль');const token=randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires<?',Date.now());run('INSERT INTO sessions VALUES(?,?,?)',tokenHash(token),user.id,Date.now()+86400000);res.setHeader('Set-Cookie',`orbita=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.PUBLIC_ORIGIN?.startsWith('https:')?'; Secure':''}`);send(safeUser(user));return;}
 if(!u)fail(401,'Войдите в аккаунт');
 if(p==='/api/logout'&&req.method==='POST'){run('DELETE FROM sessions WHERE token=?',tokenHash(cookie));res.setHeader('Set-Cookie','orbita=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send({ok:true});return}
 if(p==='/api/me'&&req.method==='GET'){send(safeUser(u));return}
 if(p==='/api/theme'&&req.method==='POST'){run('UPDATE users SET theme=? WHERE id=?',allowed(b.theme,['dark','light','violet']),u.id);send({ok:true});return}
 if(p==='/api/schedule'&&req.method==='GET'){
 const d=date(url.searchParams.get('date')||'');const day=new Date(d+'T12:00:00Z').getUTCDay();const week=Math.floor((Date.parse(d)-Date.parse('2026-08-31'))/604800000)+1;
 const lessons=all(`SELECT l.*,n.text AS note FROM lessons l LEFT JOIN notes n ON n.lesson_id=l.id AND n.user_id=? AND n.date=? WHERE l.grp=? AND ((l.date IS NULL AND l.day=? AND (l.parity='all' OR l.parity=?)) OR l.date=?) ORDER BY start`,u.id,d,u.grp,day,week%2?'odd':'even',d);
 const clubs=all("SELECT c.* FROM clubs c JOIN memberships m ON m.club_id=c.id WHERE m.user_id=? AND m.status='Вы приняты' AND c.weekday=?",u.id,day);send({lessons,clubs,week});return}
 if(p==='/api/notes'&&req.method==='POST'){const l=one('SELECT * FROM lessons WHERE id=? AND grp=?',Number(b.lesson_id),u.grp);if(!l)fail(404,'Занятие не найдено');date(b.date);if(typeof b.text!=='string'||b.text.length>2000)fail(400,'Максимум 2000 символов');run('INSERT INTO notes VALUES(?,?,?,?) ON CONFLICT(user_id,lesson_id,date) DO UPDATE SET text=excluded.text',u.id,l.id,b.date,b.text);send({ok:true});return}
 if(p==='/api/grades'&&req.method==='GET'){send(all('SELECT * FROM grades WHERE user_id=?',u.id));return}
 if(p==='/api/requests'&&req.method==='GET'){send(all('SELECT * FROM requests WHERE user_id=? ORDER BY id DESC',u.id));return}
 if(p==='/api/requests'&&req.method==='POST'){roles(u,'student');const type=allowed(b.type,['Справка об обучении','Справка о стипендии','Заявление в деканат']);const comment=typeof b.comment==='string'?b.comment.slice(0,2000):'';const r=run('INSERT INTO requests(user_id,type,comment) VALUES(?,?,?)',u.id,type,comment);send({id:Number(r.lastInsertRowid)},201);return}
 if(/^\/api\/requests\/\d+$/.test(p)&&req.method==='GET'){const r=one('SELECT * FROM requests WHERE id=? AND user_id=?',Number(p.split('/').pop()),u.id);if(!r)fail(404,'Заявка не найдена');send(r);return}
 if(p==='/api/clubs'&&req.method==='GET'){send(all('SELECT c.*,m.status AS membership FROM clubs c LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=?',u.id));return}
 if(p==='/api/join'&&req.method==='POST'){roles(u,'student');if(!one('SELECT id FROM clubs WHERE id=?',Number(b.club_id)))fail(404,'Секция не найдена');run('INSERT INTO memberships(club_id,user_id) VALUES(?,?) ON CONFLICT(club_id,user_id) DO NOTHING',Number(b.club_id),u.id);send({ok:true});return}
 if(p==='/api/events'&&req.method==='GET'){send(all('SELECT * FROM events ORDER BY date'));return}
 if(p==='/api/notices'&&req.method==='GET'){send(all('SELECT n.*,r.notice_id AS is_read FROM notices n LEFT JOIN reads r ON r.notice_id=n.id AND r.user_id=? WHERE n.user_id IS NULL OR n.user_id=? ORDER BY n.id DESC',u.id,u.id));return}
 if(p==='/api/notices/read'&&req.method==='POST'){run('INSERT OR IGNORE INTO reads SELECT ?,id FROM notices WHERE user_id IS NULL OR user_id=?',u.id,u.id);send({ok:true});return}
 if(p.startsWith('/api/manage')){
 roles(u,'admin','staff','manager');
 if(p==='/api/manage'&&req.method==='GET'){send({users:u.role==='admin'?all('SELECT id,login,name,role,grp FROM users'):[],requests:['admin','staff'].includes(u.role)?all('SELECT r.*,u.name FROM requests r JOIN users u ON r.user_id=u.id ORDER BY r.id DESC'):[],clubs:all('SELECT * FROM clubs WHERE owner=? OR ?=\'admin\'',u.id,u.role),memberships:all("SELECT m.*,u.name,c.title FROM memberships m JOIN clubs c ON c.id=m.club_id JOIN users u ON u.id=m.user_id WHERE c.owner=? OR ?='admin'",u.id,u.role)});return}
 if(p==='/api/manage/users'&&req.method==='POST'){roles(u,'admin');const password=required(b,'password',200);if(password.length<12)fail(400,'Пароль: минимум 12 символов');const r=run('INSERT INTO users(login,password,name,role,faculty,program,course,grp) VALUES(?,?,?,?,?,?,?,?)',required(b,'login',80),hash(password),required(b,'name',120),allowed(b.role,['student','staff','manager','admin']),required(b,'faculty',120),required(b,'program',120),Number(b.course)||1,required(b,'grp',40));send({id:Number(r.lastInsertRowid)},201);return}
 if(p==='/api/manage/requests'&&req.method==='POST'){roles(u,'staff','admin');const r=one('SELECT * FROM requests WHERE id=?',Number(b.id));if(!r)fail(404,'Заявка не найдена');const status=allowed(b.status,['Принята','В работе','Нужно уточнение','Готова']);run('UPDATE requests SET status=?,reply=? WHERE id=?',status,String(b.reply||'').slice(0,2000),r.id);notify(r.user_id,'Заявка №'+r.id+': '+status,String(b.reply||''));send({ok:true});return}
 if(p==='/api/manage/clubs'&&req.method==='POST'){roles(u,'admin','manager');const start=time(required(b,'start',5)),end=time(required(b,'end',5));if(end<=start)fail(400,'Окончание должно быть позже начала');const owner=u.role==='admin'?Number(b.owner)||u.id:u.id;if(!one("SELECT id FROM users WHERE id=? AND role IN ('manager','admin')",owner))fail(400,'Ответственный должен иметь роль руководителя');run('INSERT INTO clubs(title,category,description,place,weekday,start,end,owner,capacity) VALUES(?,?,?,?,?,?,?,?,?)',required(b,'title',100),allowed(b.category,['Спорт','Творчество','Наука']),required(b,'description',2000),required(b,'place',120),allowed(Number(b.weekday),[0,1,2,3,4,5,6]),start,end,owner,Math.max(1,Math.min(500,Number(b.capacity)||20)));send({ok:true},201);return}
 if(p==='/api/manage/memberships'&&req.method==='POST'){roles(u,'admin','manager');const m=one('SELECT m.*,c.owner,c.capacity FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.id=?',Number(b.id));if(!m||m.owner!==u.id&&u.role!=='admin')fail(404,'Запись не найдена');const status=allowed(b.status,['Вы приняты','На рассмотрении','Набор закрыт']);if(status==='Вы приняты'&&m.status!==status&&one("SELECT count(*) AS n FROM memberships WHERE club_id=? AND status='Вы приняты'",m.club_id).n>=m.capacity)fail(409,'Свободных мест нет');run('UPDATE memberships SET status=? WHERE id=?',status,m.id);notify(m.user_id,'Запись в секцию',status);send({ok:true});return}
 if(p==='/api/manage/events'&&req.method==='POST'){roles(u,'admin','manager');const d=required(b,'date',30);if(!Number.isFinite(Date.parse(d)))fail(400,'Проверьте дату');run('INSERT INTO events(title,type,date,place,description,owner) VALUES(?,?,?,?,?,?)',required(b,'title',120),allowed(b.type,['Сборная','Соревнование']),d,required(b,'place',120),required(b,'description',2000),u.id);send({ok:true},201);return}
 if(p==='/api/manage/lessons'&&req.method==='POST'){roles(u,'admin','staff');const start=time(required(b,'start',5)),end=time(required(b,'end',5));if(end<=start)fail(400,'Окончание должно быть позже начала');run('INSERT INTO lessons(grp,day,start,end,subject,kind,room,teacher,parity,date,status,change) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',required(b,'grp',40),allowed(Number(b.day),[0,1,2,3,4,5,6]),start,end,required(b,'subject',120),allowed(b.kind,['Лекция','Практика','Лабораторная','Экзамен','Зачёт','Консультация']),required(b,'room',120),required(b,'teacher',120),allowed(b.parity,['all','odd','even']),b.date?date(b.date):null,'scheduled','');send({ok:true},201);return}
 }
 fail(404,'Не найдено');
 }catch(e){send({error:e.status?e.message:e.code?.includes('CONSTRAINT')?'Запись уже существует или связана с другими данными':'Ошибка сервера'},e.status|| (e.code?.includes('CONSTRAINT')?409:500));if(!e.status&&!e.code?.includes('CONSTRAINT'))console.error(e)}
}
export const server=http.createServer(handler);
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Орбита: http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`));
