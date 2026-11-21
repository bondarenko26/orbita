import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {installManagement} from '../management.mjs';

test('jury schedule uses the application calendar, week exceptions and subgroups', async t => {
  const dir = mkdtempSync(path.join(tmpdir(),'orbita-jury-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const filename = path.join(dir,'orbita.sqlite');
  const server = spawn(process.execPath,['server.mjs'],{
    env:{...process.env,DATA_DIR:dir,PORT:'0',SMTP_HOST:''},stdio:['ignore','pipe','inherit']
  });
  try {
    let output = '';
    for await (const chunk of server.stdout) {
      output += chunk.toString();
      if (output.includes('http://')) break;
    }
    assert.ok(output.includes('http://'),'test application started');
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = once(server,'exit');
      server.kill();
      await stopped;
    }
  }
  const load = () => execFileSync(process.execPath,['import-jury-schedule.mjs',filename],
    {encoding:'utf8',stdio:['ignore','pipe','pipe']});
  load();
  assert.match(load(),/уже загружено/);
  const db = new DatabaseSync(filename);
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE role='student'").get().n,0);
    const {calendar} = installManagement(db,{});
    const day = (date,grp,subgroup='') => calendar(date,{id:0,grp,subgroup}).lessons;
    const at = (date,grp,time,subgroup='') => day(date,grp,subgroup).find(l=>l.start===time);
    for (const [date,subject] of [
      ['2026-08-31','Модуль 2'],['2026-09-07',undefined],['2026-09-14','Модуль 2'],
      ['2026-09-21',undefined],['2026-09-28','Модуль 1']
    ]) assert.equal(at(date,'2-52','08:30')?.subject,subject);
    for (const date of ['2026-09-09','2026-10-07','2026-11-04','2026-12-02'])
      assert.equal(at(date,'1-40','16:00').subject,'История России');
    assert.equal(at('2026-11-18','1-40','16:00'),undefined);
    assert.equal(at('2026-10-01','1-40','16:00'),undefined);
    assert.equal(at('2026-10-08','1-40','16:00').room,'522 КМК');
    assert.equal(at('2026-10-15','1-40','16:00').room,'526 КМК');
    assert.equal(at('2026-11-23','1-40','11:30','1').kind,'Лабораторная');
    assert.equal(at('2026-11-23','1-40','11:30','2'),undefined);
    assert.equal(at('2026-11-26','2-52','11:30').room,'629 КМК');
    for (const group of ['1-40','2-52']) {
      assert.deepEqual(day('2026-11-28',group),[]);
      for (const lesson of day('2026-11-24',group)) {
        assert.equal(lesson.grp,group);
        assert.ok(lesson.teacher_id && lesson.assignment_id);
      }
    }
  } finally { db.close(); }
});
