import {existsSync} from 'node:fs';
import {randomBytes, scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {groups, slots} from './reference/jury-autumn-2026.mjs';

const marker = 'jury-autumn-2026-v1';
const anchor = '2026-08-31';
const lastClassDay = '2026-12-27';
const filename = process.argv[2];
if (process.argv.length !== 3 || !existsSync(filename)) {
  throw Error('Укажите существующую базу приложения: node import-jury-schedule.mjs путь/к/orbita.sqlite');
}
const db = new DatabaseSync(filename);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);
const id = result => Number(result.lastInsertRowid);
const weekDate = (week, weekday) => new Date(Date.parse(anchor) +
  ((week - 1) * 7 + weekday - 1) * 86400000).toISOString().slice(0,10);

function semester() {
  const settings = one('SELECT * FROM settings WHERE id=1');
  if (!settings) throw Error('Сначала запустите приложение для инициализации базы.');
  if (!settings.week_anchor && !settings.semester_start && !settings.semester_end) {
    run('UPDATE settings SET semester_start=?,semester_end=?,week_anchor=? WHERE id=1',
      anchor, lastClassDay, anchor);
    return {start: anchor, end: lastClassDay};
  }
  if (settings.week_anchor !== anchor || settings.semester_start < anchor ||
      settings.semester_start > '2026-09-06' || settings.semester_end < settings.semester_start) {
    throw Error('В базе настроен другой семестр. Импорт осени 2026 отменён.');
  }
  return {start: settings.semester_start, end: [settings.semester_end,lastClassDay].sort()[0]};
}

function importGroup(group, term) {
  const institute = one('SELECT id,name FROM academic_nodes WHERE id=?',group.program_id.split('__')[0]);
  const program = one("SELECT name FROM academic_nodes WHERE id=? AND kind='program'",group.program_id);
  if (!program || !institute) throw Error('Обновите справочник программ МГСУ.');
  const groupId = id(run(`INSERT INTO groups(name,faculty,program,course,institute_id,program_id,admission_year)
    VALUES(?,?,?,?,?,?,?)`, group.name,institute.name,program.name,group.course,institute.id,
    group.program_id,2027-group.course));
  const teacherIds = new Map();
  for (const [key, name] of Object.entries(group.teachers)) {
    const login = `jury-2026-${institute.id}-${key.toLowerCase()}@example.invalid`;
    const salt = randomBytes(16).toString('hex');
    const hash = salt + ':' + scryptSync(randomBytes(32),salt,64).toString('hex');
    teacherIds.set(key,id(run(`INSERT INTO users(login,email,password,name,role,institute_id)
      VALUES(?,?,?,?,'teacher',?)`, login,login,hash,name,institute.id)));
  }
  const assignments = new Map();
  let count = 0;
  for (const [index, lessons] of group.days.entries()) {
    const day = index + 1;
    for (const entry of lessons) {
      const {subject, kind, room, teacher, parity, subgroup = ''} = entry;
      const [start,end] = slots[entry.slot-1];
      const teacherId = teacherIds.get(teacher);
      if (!teacherId) throw Error('Не указан преподаватель: '+subject);
      const from = [term.start,weekDate(entry.fromWeek || 1,1)].sort()[1];
      if (from > term.end) continue;
      const dates = entry.weeks ? entry.weeks.map(w => weekDate(w,day))
        .filter(d => d >= from && d <= term.end) : [null];
      if (!dates.length) continue;
      const key = JSON.stringify([teacher,subject,subgroup]);
      if (!assignments.has(key)) {
        assignments.set(key,id(run(`INSERT INTO teaching_assignments
          (teacher_id,group_id,subject,subgroup,semester,start_date,end_date,from_schedule)
          VALUES(?,?,?,?,?,?,?,1)`,teacherId,groupId,subject,subgroup,
          term.start+' — '+term.end,term.start,term.end)));
      }
      for (const date of dates) {
        run(`INSERT INTO lessons(grp,day,start,end,subject,kind,room,teacher,parity,date,
          subgroup,term_start,term_end,assignment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          group.name,day,start,end,subject,kind,room,group.teachers[teacher],parity,date,
          subgroup,from,term.end,assignments.get(key));
        count++;
      }
    }
  }
  return group.name+' — '+count;
}

try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  if (one('SELECT id FROM academic_imports WHERE id=?',marker)) {
    db.exec('COMMIT');
    console.log('Расписание для жюри уже загружено.');
  } else {
    for (const group of groups) {
      if (one('SELECT id FROM groups WHERE name=?',group.name)) {
        throw Error('Группа '+group.name+' уже есть в базе. Импорт отменён.');
      }
    }
    const term = semester();
    const counts = groups.map(group => importGroup(group,term));
    run('INSERT INTO academic_imports(id) VALUES(?)',marker);
    db.exec('COMMIT');
    console.log('Загружены записи расписания: '+counts.join(', '));
  }
} catch (error) {
  if (db.isTransaction) db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
