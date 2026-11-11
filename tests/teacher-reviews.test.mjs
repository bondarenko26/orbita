import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {installTeacherReviews} from '../teacher-reviews.mjs';

test('reviews are private by author, unique per pair and independent of teaching assignments',t=>{
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, active INTEGER, deleted_at TEXT);
    CREATE VIEW live_users AS SELECT * FROM users WHERE deleted_at IS NULL;
    INSERT INTO users VALUES (1,'student','Автор А',1,NULL),(2,'student','Автор Б',1,NULL),
      (3,'teacher','Преподаватель',1,NULL),(4,'teacher','Преподаватель',1,NULL),
      (5,'teacher','Удалён',1,'2026-11-11'),(6,'teacher','Отключён',0,NULL);`);
  const handle=installTeacherReviews(db,(status,message)=>{throw Object.assign(Error(message),{status})});
  const request=(id,suffix='',body)=>{
    const user=db.prepare('SELECT id,role FROM users WHERE id=?').get(id);
    let result;
    assert.ok(handle('/api/teachers'+suffix,body?'POST':'GET',body,user,data=>{result=JSON.parse(JSON.stringify(data))}));
    return result;
  };
  assert.deepEqual(request(1).map(t=>t.id),[3,4]);
  const save=(student,teacher,rating,comment)=>request(student,'/'+teacher+'/my-review',{rating,comment});
  const card=(viewer)=>request(viewer,'/3');
  assert.equal(card(1).teacher.average,null);
  save(1,3,5,'Первый отзыв');
  assert.deepEqual(card(2).comments,[{rating:5,comment:'Первый отзыв'}]);
  assert.equal(card(2).mine,null);
  assert.deepEqual(card(3),card(2));
  request(2,'/3/delete-my-review',{student_id:1});
  assert.equal(card(3).teacher.count,1);
  save(2,3,1,'');
  save(1,4,3,'Другой преподаватель');
  save(1,3,4,'Изменён');
  assert.equal(card(1).teacher.count,2);
  assert.equal(card(1).teacher.average,2.5);
  assert.deepEqual(card(2).comments,[{rating:4,comment:'Изменён'}]);
  assert.deepEqual(card(1).mine,{rating:4,comment:'Изменён'});
  assert.deepEqual(card(1).comments,[]);
  for(const rating of [0,6,2.5,'4'])assert.throws(()=>save(1,3,rating,''),{status:400});
  assert.throws(()=>save(1,3,5,'а'.repeat(2001)),{status:400});
  assert.throws(()=>save(3,3,5,''),{status:403});
  for(const id of [1,5,6])assert.throws(()=>save(1,id,5,''),{status:404});
  request(1,'/3/delete-my-review',{});
  assert.equal(card(2).teacher.average,1);
  assert.equal(request(1,'/4').mine.rating,3);
  request(2,'/3/delete-my-review',{});
  assert.equal(card(1).teacher.average,null);
  assert.equal(card(1).teacher.count,0);
});
