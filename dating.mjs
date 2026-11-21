import {randomUUID} from 'node:crypto';

const RULES_VERSION=1;
const DAILY_LIMIT=20;
const PURPOSES=['Дружба','Компания','Отношения'];
const moscowDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
const photoUrl=id=>'/api/dating/photos/'+id;
const publicFields='p.id AS id, e.id AS edition, e.alias, e.age, e.purpose, e.interests, e.about';
const eligible=`FROM dating_profiles p JOIN dating_editions e ON e.id=p.live_id AND e.state='approved'
  JOIN live_users u ON u.id=p.owner AND u.active=1 AND u.role='student'
  JOIN dating_consents a ON a.owner=p.owner AND a.version=1 WHERE p.visible=1`;
const mutuallyVisible=` AND NOT EXISTS(SELECT 1 FROM dating_blocks b
  WHERE (b.owner=? AND b.other=p.owner) OR (b.owner=p.owner AND b.other=?))`;

export function installDating(db,fail){
  db.exec(`CREATE TABLE IF NOT EXISTS dating_consents(owner INTEGER PRIMARY KEY REFERENCES users(id),version INTEGER NOT NULL,accepted INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dating_profiles(id TEXT PRIMARY KEY,owner INTEGER NOT NULL UNIQUE REFERENCES users(id),visible INTEGER NOT NULL DEFAULT 1,live_id INTEGER,draft_id INTEGER);
    CREATE TABLE IF NOT EXISTS dating_editions(id INTEGER PRIMARY KEY AUTOINCREMENT,profile TEXT NOT NULL REFERENCES dating_profiles(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,age INTEGER NOT NULL,purpose TEXT NOT NULL,interests TEXT NOT NULL,about TEXT NOT NULL,telegram TEXT NOT NULL,
      source BLOB,photo BLOB,state TEXT NOT NULL DEFAULT 'pending',field TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL DEFAULT '',
      available INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS dating_due ON dating_editions(state,available);
    CREATE INDEX IF NOT EXISTS dating_versions ON dating_editions(profile);
    CREATE TABLE IF NOT EXISTS dating_blocks(owner INTEGER NOT NULL REFERENCES users(id),other INTEGER NOT NULL REFERENCES users(id),label TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner,other));
    CREATE TABLE IF NOT EXISTS dating_skips(owner INTEGER NOT NULL REFERENCES users(id),profile TEXT NOT NULL REFERENCES dating_profiles(id) ON DELETE CASCADE,PRIMARY KEY(owner,profile));
    CREATE TABLE IF NOT EXISTS dating_invites(sender INTEGER NOT NULL REFERENCES users(id),recipient INTEGER NOT NULL REFERENCES users(id),created INTEGER NOT NULL,dismissed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(sender,recipient));
    CREATE INDEX IF NOT EXISTS dating_incoming ON dating_invites(recipient,dismissed,created);
    CREATE TABLE IF NOT EXISTS dating_daily(sender INTEGER NOT NULL REFERENCES users(id),day TEXT NOT NULL,recipient INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(sender,day,recipient));
    CREATE TABLE IF NOT EXISTS dating_cases(id INTEGER PRIMARY KEY,edition INTEGER NOT NULL REFERENCES dating_editions(id) ON DELETE CASCADE,
      author INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS dating_unique_case ON dating_cases(edition,author,kind);
    CREATE INDEX IF NOT EXISTS dating_open_cases ON dating_cases(closed,created);`);
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  function transaction(fn){
    db.exec('BEGIN IMMEDIATE');
    try{const value=fn();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error}
  }
  const accepted=id=>Boolean(one('SELECT 1 FROM dating_consents WHERE owner=? AND version=?',id,RULES_VERSION));
  function requireStudent(u){
    if(u.role!=='student')fail(403,'Знакомства доступны студентам.');
  }
  function requireConsent(u){
    requireStudent(u);
    if(!accepted(u.id))fail(403,'Подтверди совершеннолетие и прими правила.');
  }
  function requireAdmin(u){if(u.role!=='admin')fail(403,'Недостаточно прав');}
  const profileOf=id=>one('SELECT * FROM dating_profiles WHERE owner=?',id);
  const active=id=>one('SELECT p.id '+eligible+' AND p.owner=?',id);
  const target=(viewer,profile)=>one('SELECT p.owner,'+publicFields+' '+eligible+mutuallyVisible+' AND p.owner<>? AND p.id=?',viewer,viewer,viewer,profile);
  const today=()=>moscowDay.format(Date.now());
  const used=id=>one('SELECT count(*) AS n FROM dating_daily WHERE sender=? AND day=?',id,today()).n;
  function card(row){
    if(!row)return null;
    const {id,alias,age,purpose,interests,about,edition}=row;
    return {id,alias,age,purpose,interests,about,edition,photo:photoUrl(edition)};
  }
  function field(value,name,max,required=true){
    if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail(400,'Проверь поле «'+name+'».');
    return value.trim();
  }
  function state(u){
    requireStudent(u);
    if(!accepted(u.id))return {accepted:false};
    const p=profileOf(u.id);
    const d=p&&one(`SELECT id,alias,age,purpose,interests,about,telegram,state,field,reason,photo IS NOT NULL AS hasPhoto,
      (SELECT CASE WHEN closed=0 THEN 'open' ELSE 'closed' END FROM dating_cases WHERE edition=e.id AND kind='appeal') AS appeal FROM dating_editions e WHERE id=?`,p.draft_id);
    const own=d?{...d,photo:d.hasPhoto?photoUrl(d.id):null,canReuse:!!one('SELECT 1 FROM dating_editions WHERE id=? AND (source IS NOT NULL OR photo IS NOT NULL)',d.id),visible:!!p.visible,live:!!p.live_id,
      liveEdition:p.live_id,liveTelegram:p.live_id?one('SELECT telegram FROM dating_editions WHERE id=?',p.live_id).telegram:null}:null;
    const next=one('SELECT '+publicFields+' '+eligible+mutuallyVisible+` AND p.owner<>?
      AND NOT EXISTS(SELECT 1 FROM dating_skips WHERE owner=? AND profile=p.id)
      AND NOT EXISTS(SELECT 1 FROM dating_invites WHERE sender=? AND recipient=p.owner) ORDER BY p.rowid LIMIT 1`,u.id,u.id,u.id,u.id,u.id);
    const canInvite=!!active(u.id);
    const inbox=canInvite?all('SELECT '+publicFields+',e.telegram,i.created '+eligible.replace(' WHERE p.visible=1',' JOIN dating_invites i ON i.sender=p.owner WHERE p.visible=1')+
      mutuallyVisible+' AND i.recipient=? AND i.dismissed=0 ORDER BY i.created DESC,p.id LIMIT 100',u.id,u.id,u.id).map(row=>({...card(row),telegram:row.telegram,created:row.created})):[];
    const blocked=all("SELECT rowid AS id,label FROM dating_blocks WHERE owner=? ORDER BY rowid DESC",u.id);
    return {accepted:true,own,canInvite,card:card(next),inbox,blocked,remaining:Math.max(0,DAILY_LIMIT-used(u.id)),limit:DAILY_LIMIT,
      skipped:!!one('SELECT 1 FROM dating_skips WHERE owner=? LIMIT 1',u.id)};
  }
  function trimVersions(p){
    run(`DELETE FROM dating_editions WHERE profile=? AND id NOT IN
      (SELECT coalesce(live_id,-1) FROM dating_profiles WHERE id=? UNION SELECT coalesce(draft_id,-1) FROM dating_profiles WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM dating_cases WHERE edition=dating_editions.id AND closed=0)`,p,p,p);
  }
  function submit(u,b){
    requireConsent(u);
    const alias=field(b.alias,'Имя',42),about=field(b.about,'О себе',550);
    const interests=field(b.interests??'','Интересы',100,false);
    if(!Number.isInteger(b.age)||b.age<18||b.age>120)fail(400,'Укажи возраст от 18 до 120 лет.');
    if(!PURPOSES.includes(b.purpose))fail(400,'Выбери цель знакомства.');
    const telegram=field(b.telegram,'Telegram',33).replace(/^@/,'');
    if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegram))fail(400,'Telegram-ник должен содержать от 5 до 32 латинских букв, цифр или подчёркиваний и начинаться с буквы.');
    let source;
    if(b.image!==undefined){
      if(typeof b.image!=='string'||!b.image.length||b.image.length>800000||!/^([A-Za-z0-9+/]+={0,2})$/.test(b.image))fail(400,'Проверь файл фотографии.');
      source=Buffer.from(b.image,'base64');
      if(!source.length||source.length>600000||source.toString('base64')!==b.image)fail(400,'Проверь файл фотографии.');
    }
    transaction(()=>{
      let p=profileOf(u.id);
      if((b.previous??null)!==(p?.draft_id??null))fail(409,'Анкета уже изменилась. Открой её заново.');
      if(!source&&p)source=one('SELECT coalesce(photo,source) AS bytes FROM dating_editions WHERE id=?',p.draft_id)?.bytes;
      if(!source)fail(400,'Добавь фотографию.');
      if(!p){
        const id=randomUUID();run('INSERT INTO dating_profiles(id,owner) VALUES(?,?)',id,u.id);p=profileOf(u.id);
      }
      const result=run(`INSERT INTO dating_editions(profile,alias,age,purpose,interests,about,telegram,source,created) VALUES(?,?,?,?,?,?,?,?,?)`,
        p.id,alias,b.age,b.purpose,interests,about,telegram,source,Date.now());
      run('UPDATE dating_profiles SET draft_id=? WHERE id=?',Number(result.lastInsertRowid),p.id);
      if(p.draft_id)run("UPDATE dating_cases SET closed=1 WHERE edition=? AND kind IN ('review','appeal')",p.draft_id);
      trimVersions(p.id);
    });
    return {queued:true};
  }
  function take(){
    return transaction(()=>{
      const now=Date.now();
      const job=one(`SELECT e.*,p.owner FROM dating_editions e JOIN dating_profiles p ON p.draft_id=e.id
        JOIN live_users u ON u.id=p.owner AND u.active=1 AND u.role='student'
        WHERE e.state='pending' AND e.available<=? ORDER BY e.available,e.id LIMIT 1`,now);
      if(!job)return null;
      const lease=randomUUID();
      run('UPDATE dating_editions SET available=?,lease=?,attempts=attempts+1 WHERE id=?',now+90000,lease,job.id);
      return {...job,lease};
    });
  }
  function finish(job,result){
    transaction(()=>{
      const current=one(`SELECT e.id FROM dating_editions e JOIN dating_profiles p ON p.draft_id=e.id WHERE e.id=? AND e.lease=? AND e.state='pending'`,job.id,job.lease);
      if(!current)return;
      run('UPDATE dating_editions SET state=?,field=?,reason=?,photo=?,source=NULL,lease=NULL WHERE id=?',
        result.state,result.field,result.reason,result.photo,job.id);
      if(result.state==='approved')run('UPDATE dating_profiles SET live_id=? WHERE id=?',job.id,job.profile);
      if(result.state==='review')run("INSERT INTO dating_cases(edition,author,kind,detail,created) VALUES(?,?,'review',?,?)",job.id,job.owner,result.reason,Date.now());
      trimVersions(job.profile);
    });
  }
  function retry(job){
    const delay=Math.min(900000,12000*2**Math.min(job.attempts,7));
    run("UPDATE dating_editions SET available=?,lease=NULL WHERE id=? AND lease=? AND state='pending'",Date.now()+delay,job.id,job.lease);
  }
  function readPhoto(u,id){
    if(u.role==='admin'){
      const row=one('SELECT e.photo FROM dating_editions e WHERE e.id=? AND EXISTS(SELECT 1 FROM dating_cases WHERE edition=e.id AND closed=0)',id);
      if(row?.photo)return row.photo;
    }else{
      requireConsent(u);
      const own=one('SELECT e.photo FROM dating_editions e JOIN dating_profiles p ON p.id=e.profile WHERE e.id=? AND p.owner=? AND (e.id=p.draft_id OR e.id=p.live_id)',id,u.id);
      if(own?.photo)return own.photo;
      const row=one('SELECT e.photo '+eligible+mutuallyVisible+' AND e.id=?',u.id,u.id,id);
      if(row?.photo)return row.photo;
    }
    fail(404,'Фото недоступно.');
  }
  function profileAction(u,action,b){
    const p=profileOf(u.id);
    if(!p)fail(404,'Анкета не найдена.');
    if(action==='visibility'){
      if(typeof b.visible!=='boolean')fail(400,'Проверь видимость анкеты.');
      run('UPDATE dating_profiles SET visible=? WHERE id=?',+b.visible,p.id);
    }else if(action==='delete'){
      run('DELETE FROM dating_invites WHERE sender=? OR recipient=?',u.id,u.id);
      run("UPDATE dating_blocks SET label='' WHERE other=?",u.id);
      run('DELETE FROM dating_profiles WHERE id=?',p.id);
    }else{
      const edition=one('SELECT id,state,photo IS NOT NULL AS validPhoto FROM dating_editions WHERE id=?',p.draft_id);
      if(edition.state!=='rejected'||!edition.validPhoto)fail(409,'Для этой версии пересмотр недоступен.');
      const detail=field(b.detail,'Причина пересмотра',350);
      const existing=one("SELECT closed FROM dating_cases WHERE edition=? AND author=? AND kind='appeal'",edition.id,u.id);
      if(existing?.closed)fail(409,'Эту версию уже пересмотрели. Можно отредактировать анкету.');
      run("INSERT OR IGNORE INTO dating_cases(edition,author,kind,detail,created) VALUES(?,?,'appeal',?,?)",edition.id,u.id,detail,Date.now());
    }
  }
  function contact(u,action,b){
    if(typeof b.profile!=='string')fail(400,'Выбери анкету.');
    const other=target(u.id,b.profile);
    if(!other)fail(404,'Анкета недоступна.');
    if(b.edition!==undefined&&b.edition!==other.edition)fail(409,'Анкета изменилась. Обнови её и повтори действие.');
    if(action==='invite'){
      if(!active(u.id))fail(403,'Для знакомства нужна своя опубликованная анкета.');
      if(b.senderEdition!==undefined&&b.senderEdition!==profileOf(u.id).live_id)fail(409,'Твоя опубликованная анкета изменилась. Проверь ник и отправь приглашение заново.');
      if(one('SELECT 1 FROM dating_invites WHERE sender=? AND recipient=?',u.id,other.owner))return;
      const day=today();
      if(one('SELECT 1 FROM dating_daily WHERE sender=? AND day=? AND recipient=?',u.id,day,other.owner))fail(409,'Ты уже приглашал этого человека сегодня.');
      if(used(u.id)>=DAILY_LIMIT)fail(429,'Сегодня уже отправлено 20 приглашений. Новый лимит появится в полночь по Москве.');
      run('INSERT OR IGNORE INTO dating_daily VALUES(?,?,?)',u.id,day,other.owner);
      run('DELETE FROM dating_daily WHERE sender=? AND day<?',u.id,day);
      run('INSERT INTO dating_invites(sender,recipient,created) VALUES(?,?,?)',u.id,other.owner,Date.now());
      run('INSERT INTO notices(user_id,title,body,destination) VALUES(?,?,?,?)',other.owner,'Новое приглашение','Открой «Разное» → «Знакомства» → «Приглашения».','dating');
    }else if(action==='dismiss'){
      run('UPDATE dating_invites SET dismissed=1 WHERE sender=? AND recipient=?',other.owner,u.id);
    }else if(action==='block'){
      run('INSERT OR IGNORE INTO dating_blocks(owner,other,label) VALUES(?,?,?)',u.id,other.owner,other.alias);
      run('DELETE FROM dating_invites WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)',u.id,other.owner,other.owner,u.id);
    }else{
      if(action==='report'){
        const detail=field(b.detail,'Причина жалобы',350);
        run("INSERT OR IGNORE INTO dating_cases(edition,author,kind,detail,created) VALUES(?,?,'report',?,?)",other.edition,u.id,detail,Date.now());
      }
      run('INSERT OR IGNORE INTO dating_skips(owner,profile) VALUES(?,?)',u.id,b.profile);
    }
  }
  function cases(){
    return all(`SELECT c.id,c.kind,c.detail,c.created,e.id AS edition,e.alias,e.age,e.purpose,e.interests,e.about,e.field,e.reason,e.photo IS NOT NULL AS hasPhoto
      FROM dating_cases c JOIN dating_editions e ON e.id=c.edition WHERE c.closed=0 ORDER BY c.created,c.id LIMIT 40`)
      .map(row=>({...row,photo:row.hasPhoto?photoUrl(row.edition):null}));
  }
  function decide(b){
    if(!Number.isSafeInteger(b.id)||!['approve','reject'].includes(b.decision))fail(400,'Проверь решение.');
    const c=one(`SELECT c.*,e.profile,e.photo IS NOT NULL AS validPhoto,p.live_id,p.draft_id FROM dating_cases c
      JOIN dating_editions e ON e.id=c.edition JOIN dating_profiles p ON p.id=e.profile WHERE c.id=? AND c.closed=0`,b.id);
    if(!c)fail(409,'Обращение уже обработано.');
    const reject=b.decision==='reject';
    const reason=reject?field(b.reason,'Причина',350):'';
    if(c.kind==='report'){
      if(reject&&c.live_id===c.edition){
        run('UPDATE dating_profiles SET live_id=NULL WHERE id=?',c.profile);
        run("UPDATE dating_editions SET state='rejected',field='Анкета',reason=? WHERE id=?",reason,c.edition);
      }
    }else if(c.edition===c.draft_id){
      if(!reject&&!c.validPhoto)fail(409,'Для публикации нужна проверенная фотография.');
      run("UPDATE dating_editions SET state=?,field=?,reason=? WHERE id=?",reject?'rejected':'approved',reject?'Анкета':'',reason,c.edition);
      if(!reject)run('UPDATE dating_profiles SET live_id=? WHERE id=?',c.edition,c.profile);
    }
    run('UPDATE dating_cases SET closed=1 WHERE edition=? AND kind=?',c.edition,c.kind);
    trimVersions(c.profile);
  }
  function handle(p,method,b,u,send,res,wake){
    if(!p.startsWith('/api/dating/'))return false;
    const action=p.slice('/api/dating/'.length);
    let result={ok:true},status=200;
    if(action==='cases'||action==='decide'){
      requireAdmin(u);
      if(action==='cases'&&method==='GET')result=cases();
      else if(action==='decide'&&method==='POST')transaction(()=>decide(b));
      else fail(405,'Метод недоступен.');
    }else if(/^photos\/[1-9]\d*$/.test(action)&&method==='GET'){
      const bytes=readPhoto(u,Number(action.slice(7)));
      res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});res.end(bytes);return true;
    }else if(action==='state'&&method==='GET')result=state(u);
    else if(action==='accept'&&method==='POST'){
      requireStudent(u);
      if(b.adult!==true||b.rules!==RULES_VERSION)fail(400,'Подтверди совершеннолетие и согласие с правилами.');
      run('INSERT INTO dating_consents VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,accepted=excluded.accepted',u.id,RULES_VERSION,Date.now());
    }else{
      requireConsent(u);
      if(method!=='POST')fail(405,'Метод недоступен.');
      if(action==='profile'){result=submit(u,b);wake();status=202}
      else if(['visibility','delete','appeal'].includes(action))transaction(()=>profileAction(u,action,b));
      else if(['skip','invite','block','report','dismiss'].includes(action))transaction(()=>contact(u,action,b));
      else if(action==='unblock'){
        if(!Number.isSafeInteger(b.id))fail(400,'Выбери участника из своего списка.');
        run('DELETE FROM dating_blocks WHERE rowid=? AND owner=?',b.id,u.id);
      }
      else if(action==='reset-skips')run('DELETE FROM dating_skips WHERE owner=?',u.id);
      else fail(404,'Не найдено.');
    }
    send(result,status);return true;
  }
  return {handle,requireConsent,queue:{take,finish,retry}};
}
