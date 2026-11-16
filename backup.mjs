import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync,copyFileSync,chmodSync,unlinkSync} from 'node:fs';
import path from 'node:path';
const data=process.env.DATA_DIR;
const destination=process.argv[2];
if(!data||!destination)throw Error('Usage: DATA_DIR=/path/to/data node backup.mjs /path/to/backup.sqlite');
mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
const source=new DatabaseSync(path.join(data,'orbita.sqlite'),{readOnly:true});
await backup(source,destination);source.close();
const check=new DatabaseSync(destination,{readOnly:true});
if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');
check.close();chmodSync(destination,0o600);
for(const suffix of ['-wal','-shm'])if(existsSync(destination+suffix))unlinkSync(destination+suffix);
const key=process.env.MAIL_KEY_FILE||path.join(data,'mail.key');
if(existsSync(key)){copyFileSync(key,destination+'.mail-key');chmodSync(destination+'.mail-key',0o600)}
console.log('Backup verified: '+destination);
