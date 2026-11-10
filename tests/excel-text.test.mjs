import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const job=(task,values)=>new Promise((resolve,reject)=>{const w=new Worker(new URL('../account-worker.mjs',import.meta.url),{workerData:{task,...values}});w.once('message',m=>{w.terminate();m.ok?resolve(m.result):reject(Error(m.error))});w.once('error',reject)});
test('template preserves group text and imports only displayed email from automatic hyperlinks',async()=>{
 const bytes=Buffer.from(await job('template',{data:{groups:[],institutes:[]}}));
 const zip=await JSZip.loadAsync(bytes),styles=await zip.file('xl/styles.xml').async('string'),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 const formats=styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
 for(let r=2;r<=201;r++)for(const c of ['C','F']){const tag=xml.match(new RegExp('<c r="'+c+r+'"[^>]*>'))[0],id=Number(tag.match(/s="(\d+)"/)[1]);assert.match(formats[id],/quotePrefix="1"/);assert.match(formats[id],/numFmtId="49"/)}
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const s=wb.getWorksheet('Аккаунты');
 for(const r of [2,50,201])for(let c=1;c<=6;c++)assert.equal(s.getCell(r,c).numFmt,'@');
 s.getRow(2).values=['Тестовый Студент','Студент','1-40','01','','student@example.test'];
 s.getCell('F2').value={text:'student@example.test',hyperlink:'mailto:student@example.test'};
 let rows=await job('parse',{buffer:await wb.xlsx.writeBuffer()});assert.equal(rows[0].group,'1-40');assert.equal(rows[0].subgroup,'01');assert.equal(rows[0].email,'student@example.test');
 s.getCell('F2').value={text:'student@example.test',hyperlink:'https://invalid.example/ignored'};
 rows=await job('parse',{buffer:await wb.xlsx.writeBuffer()});assert.equal(rows[0].email,'student@example.test');
 s.getCell('C2').value="'1-40";s.getCell('F2').value="'student@example.test";rows=await job('parse',{buffer:await wb.xlsx.writeBuffer()});assert.equal(rows[0].group,'1-40');assert.equal(rows[0].email,'student@example.test');
 s.getCell('C2').value={formula:'1-40',result:-39};await assert.rejects(job('parse',{buffer:await wb.xlsx.writeBuffer()}),/C2.*формула/);
 s.getCell('C2').value='1-40';s.getCell('F2').value={formula:'HYPERLINK("mailto:student@example.test","student@example.test")',result:'student@example.test'};await assert.rejects(job('parse',{buffer:await wb.xlsx.writeBuffer()}),/F2.*формула/);
 s.getCell('F2').value='student@example.test';s.getCell('C2').value=new Date('2040-01-01');s.getCell('C2').numFmt='dd.mm.yyyy';await assert.rejects(job('parse',{buffer:await wb.xlsx.writeBuffer()}),/C2.*дату/);
});
