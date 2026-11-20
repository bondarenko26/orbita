export const trashRetentionMs = 30 * 24 * 60 * 60 * 1000;

export function purgeTrash(db, now = Date.now()) {
 const cutoff = new Date(now - trashRetentionMs).toISOString();
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(`
   CREATE TEMP TABLE expired_users(id INTEGER PRIMARY KEY);
   CREATE TEMP TABLE expired_lessons(id INTEGER PRIMARY KEY);
   CREATE TEMP TABLE expired_clubs(id INTEGER PRIMARY KEY);
   CREATE TEMP TABLE expired_grades(id INTEGER PRIMARY KEY);
   CREATE TEMP TABLE expired_groups(id INTEGER PRIMARY KEY);
   CREATE TEMP TABLE expired_events(id INTEGER PRIMARY KEY);
  `);
  for (const table of ['users','lessons','clubs','grades','groups','events']) {
   db.prepare(`INSERT INTO expired_${table} SELECT id FROM ${table}
    WHERE julianday(deleted_at) <= julianday(?)`).run(cutoff);
  }
  db.exec(`
   INSERT OR IGNORE INTO expired_grades SELECT id FROM grades WHERE user_id IN expired_users;
   DELETE FROM journal_history WHERE (entity='grades' AND record_id IN expired_grades)
     OR (entity='attendance' AND record_id IN (
       SELECT id FROM attendance WHERE lesson_id IN expired_lessons OR user_id IN expired_users));
   DELETE FROM attendance WHERE lesson_id IN expired_lessons OR user_id IN expired_users;
   DELETE FROM notes WHERE lesson_id IN expired_lessons OR user_id IN expired_users;
   DELETE FROM exceptions WHERE lesson_id IN expired_lessons;
   DELETE FROM grades WHERE id IN expired_grades;
   DELETE FROM lessons WHERE id IN expired_lessons;
   DELETE FROM memberships WHERE club_id IN expired_clubs OR user_id IN expired_users;
   DELETE FROM clubs WHERE id IN expired_clubs;
   DELETE FROM events WHERE id IN expired_events;

   DELETE FROM teacher_reviews WHERE teacher_id IN expired_users OR student_id IN expired_users;
   DELETE FROM support_tickets WHERE author_id IN expired_users;
   UPDATE support_tickets SET responder_id=NULL WHERE responder_id IN expired_users;
   DELETE FROM documents WHERE request_id IN (SELECT id FROM requests WHERE user_id IN expired_users);
   UPDATE documents SET issued_by=NULL WHERE issued_by IN expired_users;
   DELETE FROM requests WHERE user_id IN expired_users;
   DELETE FROM reads WHERE user_id IN expired_users OR notice_id IN (SELECT id FROM notices WHERE user_id IN expired_users);
   DELETE FROM notices WHERE user_id IN expired_users;
   DELETE FROM dating_profiles WHERE owner IN expired_users;
   DELETE FROM dating_consents WHERE owner IN expired_users;
   DELETE FROM dating_cases WHERE author IN expired_users;
   DELETE FROM dating_blocks WHERE owner IN expired_users OR other IN expired_users;
   DELETE FROM dating_skips WHERE owner IN expired_users;
   DELETE FROM dating_invites WHERE sender IN expired_users OR recipient IN expired_users;
   DELETE FROM dating_daily WHERE sender IN expired_users OR recipient IN expired_users;
   DELETE FROM sessions WHERE user_id IN expired_users;
   DELETE FROM password_attempts WHERE user_id IN expired_users;
   DELETE FROM email_changes WHERE user_id IN expired_users;
   DELETE FROM mail_jobs WHERE user_id IN expired_users;
   DELETE FROM staff_scopes WHERE user_id IN expired_users;
   UPDATE audit SET actor=NULL WHERE actor IN expired_users;
   UPDATE account_imports SET actor=NULL WHERE actor IN expired_users;
   UPDATE journal_history SET actor=NULL WHERE actor IN expired_users;

   DELETE FROM teaching_assignments
   WHERE (teacher_id IN expired_users OR group_id IN expired_groups)
     AND NOT EXISTS(SELECT 1 FROM lessons WHERE assignment_id=teaching_assignments.id)
     AND NOT EXISTS(SELECT 1 FROM grades WHERE assignment_id=teaching_assignments.id)
     AND NOT EXISTS(SELECT 1 FROM attendance WHERE assignment_id=teaching_assignments.id)
     AND NOT EXISTS(SELECT 1 FROM journal_history WHERE assignment_id=teaching_assignments.id);

   DELETE FROM users WHERE id IN expired_users
     AND NOT EXISTS(SELECT 1 FROM teaching_assignments WHERE teacher_id=users.id)
     AND NOT EXISTS(SELECT 1 FROM clubs WHERE owner=users.id)
     AND NOT EXISTS(SELECT 1 FROM events WHERE owner=users.id);
   -- Keep a neutral reference for surviving lessons, grades and restorable activities.
   UPDATE users SET login='!removed-account:' || id, password='', email=NULL,
     name='Удалённый аккаунт', active=0, group_id=NULL, grp='', faculty='', program='',
     institute_id=NULL, course=1, subgroup='', temporary_password_expires=NULL
   WHERE id IN expired_users AND login<>'!removed-account:' || id;

   DELETE FROM groups WHERE id IN expired_groups
     AND NOT EXISTS(SELECT 1 FROM users WHERE group_id=groups.id OR grp=groups.name)
     AND NOT EXISTS(SELECT 1 FROM lessons WHERE grp=groups.name)
     AND NOT EXISTS(SELECT 1 FROM teaching_assignments WHERE group_id=groups.id);

   DROP TABLE expired_users;
   DROP TABLE expired_lessons;
   DROP TABLE expired_clubs;
   DROP TABLE expired_grades;
   DROP TABLE expired_groups;
   DROP TABLE expired_events;
   COMMIT;
  `);
 } catch (error) {
  db.exec('ROLLBACK');
  throw error;
 }
}
