export function installTeacherReviews(db, fail) {
  db.exec(`CREATE TABLE IF NOT EXISTS teacher_reviews (
    teacher_id INTEGER NOT NULL REFERENCES users(id),
    student_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
    PRIMARY KEY(teacher_id, student_id)
  )`);
  const summary = `SELECT t.id, t.name, count(r.rating) AS count, avg(r.rating) AS average
    FROM live_users t LEFT JOIN teacher_reviews r ON r.teacher_id=t.id
    WHERE t.active=1 AND t.role='teacher'`;
  const catalog = db.prepare(summary + ' GROUP BY t.id ORDER BY t.name, t.id');
  const teacher = db.prepare(summary + ' AND t.id=? GROUP BY t.id');
  const own = db.prepare('SELECT rating, comment FROM teacher_reviews WHERE teacher_id=? AND student_id=?');
  const comments = db.prepare(`SELECT rating, comment FROM teacher_reviews
    WHERE teacher_id=? AND student_id<>? AND comment<>'' ORDER BY rowid DESC`);
  const save = db.prepare(`INSERT INTO teacher_reviews(teacher_id,student_id,rating,comment) VALUES(?,?,?,?)
    ON CONFLICT(teacher_id, student_id) DO UPDATE SET rating=excluded.rating, comment=excluded.comment`);
  const remove = db.prepare('DELETE FROM teacher_reviews WHERE teacher_id=? AND student_id=?');

  return function handle(path, method, body, viewer, send) {
    if (path==='/api/teachers' && method==='GET') {
      send(catalog.all());
      return true;
    }
    const route = /^\/api\/teachers\/(\d+)(?:\/(my-review|delete-my-review))?$/.exec(path);
    if (!route) return false;
    const id = Number(route[1]);
    const profile = teacher.get(id);
    if (!profile) fail(404,'Преподаватель не найден');
    if (!route[2] && method==='GET') {
      const viewerId = viewer.role==='student' ? viewer.id : 0;
      send({teacher:profile, mine:own.get(id,viewerId) ?? null, comments:comments.all(id,viewerId)});
      return true;
    }
    if (!route[2] || method!=='POST') return false;
    if (viewer.role!=='student') fail(403,'Оставлять отзывы могут только студенты');
    if (route[2]==='delete-my-review') {
      remove.run(id,viewer.id);
    } else {
      const {rating, comment=''} = body;
      if (!Number.isInteger(rating) || rating<1 || rating>5) fail(400,'Выберите от 1 до 5 звёзд');
      if (typeof comment!=='string' || comment.length>2000) fail(400,'Комментарий должен быть не длиннее 2000 символов');
      save.run(id,viewer.id,rating,comment.trim());
    }
    send({ok:true});
    return true;
  };
}
