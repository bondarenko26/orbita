export function installSupport(db, {required, fail}) {
  db.exec(`CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reply TEXT,
    responder_id INTEGER REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS support_by_author ON support_tickets(author_id,id);`);
  const fields = 't.id,t.subject,t.message,t.created,t.reply';
  const mine = db.prepare(`SELECT ${fields} FROM support_tickets t WHERE t.author_id=? ORDER BY t.id DESC`);
  const inbox = db.prepare(`SELECT ${fields},u.name AS author FROM support_tickets t
    JOIN users u ON u.id=t.author_id ORDER BY (t.reply IS NULL) DESC,t.id DESC`);
  const insert = db.prepare('INSERT INTO support_tickets(author_id,subject,message) VALUES(?,?,?)');
  const notifyAdmins = db.prepare(`INSERT INTO notices(user_id,title,body)
    SELECT id,?,? FROM live_users WHERE role='admin' AND active=1`);
  const answer = db.prepare(`UPDATE support_tickets SET reply=?,responder_id=?
    WHERE id=? AND reply IS NULL RETURNING author_id`);
  const notifyAuthor = db.prepare('INSERT INTO notices(user_id,title,body) VALUES(?,?,?)');
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return function handle(path, method, body, user, send) {
    if (path==='/api/support' && method==='GET') {
      send(mine.all(user.id));
    } else if (path==='/api/support' && method==='POST') {
      const subject=required(body,'subject',120), message=required(body,'message',2000);
      const id=atomic(()=>{
        const ticket=Number(insert.run(user.id,subject,message).lastInsertRowid);
        notifyAdmins.run('Новое обращение в поддержку №'+ticket,'Откройте «Профиль → Техподдержка → Входящие».');
        return ticket;
      });
      send({id},201);
    } else if (path==='/api/support/inbox' && method==='GET') {
      if (user.role!=='admin') fail(403,'Недостаточно прав');
      send(inbox.all());
    } else if (/^\/api\/support\/\d+\/reply$/.test(path) && method==='POST') {
      if (user.role!=='admin') fail(403,'Недостаточно прав');
      const id=Number(path.split('/')[3]), reply=required(body,'reply',2000);
      atomic(()=>{
        const ticket=answer.get(reply,user.id,id);
        if (!ticket) fail(409,'Обращение уже закрыто или недоступно');
        notifyAuthor.run(ticket.author_id,'Ответ техподдержки по обращению №'+id,'Ответ доступен в разделе «Профиль → Техподдержка».');
      });
      send({ok:true});
    } else return false;
    return true;
  };
}
