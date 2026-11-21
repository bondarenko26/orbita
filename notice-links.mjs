// Older versions stored the destination only in the text of system messages.
// Migrate personal system notices once, excluding staff-authored announcements.
function previousDestination(title) {
  const numbered = [
    [/^Новая заявка №(\d+)$/, 'request-inbox'],
    [/^Заявка №(\d+): /, 'request-mine'],
    [/^Новое обращение в поддержку №(\d+)$/, 'support-inbox'],
    [/^Ответ техподдержки по обращению №(\d+)$/, 'support-mine']
  ];
  for (const [pattern, kind] of numbered) {
    const match = pattern.exec(title);
    if (match) return kind + '/' + match[1];
  }
  if (/^Новая запись в секцию «/.test(title)) return 'memberships';
  if (title === 'Запись в секцию' || /^Изменение в секции «/.test(title)) return 'clubs';
  if (['Оценка восстановлена', 'Оценка удалена', 'Обновлена успеваемость'].includes(title)) return 'grades';
  if (['Новое занятие', 'Изменение занятия', 'Изменение расписания'].includes(title)) return 'schedule';
  return title === 'Новое приглашение' ? 'dating' : '';
}

export function migrateNoticeLinks(db) {
  if (db.prepare('PRAGMA table_info(notices)').all().some(c => c.name === 'destination')) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec("ALTER TABLE notices ADD COLUMN destination TEXT NOT NULL DEFAULT ''");
    const notices = db.prepare(`SELECT id,title FROM notices n WHERE user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM audit WHERE entity='notices' AND record_id=n.id)`).all();
    const update = db.prepare('UPDATE notices SET destination=? WHERE id=?');
    for (const notice of notices) {
      const destination = previousDestination(notice.title);
      if (destination) update.run(destination, notice.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Resolve against current permissions on tap, including after a group transfer.
export function resolveNoticeLink(destination, user, one, academic) {
  if (!destination) return null;
  const [kind, key] = destination.split('/');
  if (kind === 'request-inbox' || kind === 'request-mine') {
    const request = one('SELECT r.user_id FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?', key);
    if (!request) return null;
    if (kind === 'request-inbox' && ['admin','staff'].includes(user.role) && academic.canStudent(user, request.user_id)) return destination;
    if (kind === 'request-mine' && user.role === 'student' && request.user_id === user.id) return destination;
    return null;
  }
  if (kind === 'memberships') return ['admin','manager'].includes(user.role) ? kind : null;
  if (kind === 'support-inbox') return user.role === 'admin' ? destination : null;
  if (kind === 'support-mine') return one('SELECT id FROM support_tickets WHERE id=? AND author_id=?',key,user.id) ? destination : null;
  return ['clubs','grades','dating','schedule','session'].includes(kind) && user.role === 'student' ? destination : null;
}
