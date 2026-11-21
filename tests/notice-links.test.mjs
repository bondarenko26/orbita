import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateNoticeLinks} from '../notice-links.mjs';

test('existing personal system notices acquire links while announcements keep their own text',t=>{
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(`CREATE TABLE notices(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT);
    CREATE TABLE audit(entity TEXT,record_id INTEGER);
    INSERT INTO notices VALUES (1,8,'Новая заявка №42'),(2,7,'Заявка №42: Готова'),
      (3,8,'Новая заявка №77'),(4,NULL,'Новая заявка №91'),(5,7,'Новости');
    INSERT INTO audit VALUES ('notices',3);`);
  migrateNoticeLinks(db);
  migrateNoticeLinks(db);
  assert.deepEqual(db.prepare('SELECT destination FROM notices ORDER BY id').all().map(n=>n.destination),
    ['request-inbox/42','request-mine/42','','','']);
});
