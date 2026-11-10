import {parentPort,workerData} from 'node:worker_threads';
import {temporaryPassword} from './credentials.mjs';
import ExcelJS from 'exceljs';
import {addTextPrefixes} from './xlsx-text-prefix.mjs';
import yauzl from 'yauzl';
import {randomBytes,scryptSync} from 'node:crypto';
const headers=['ФИО','Роль','Группа','Подгруппа','Институт','Email'];
async function inspectArchive(buffer){
 return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(err,zip)=>{
  if(err)return reject(Error('Файл повреждён или не является XLSX'));let total=0,count=0;const seen=new Set();
  const bad=e=>{zip.close();reject(e)};zip.on('error',bad);zip.on('end',resolve);
  zip.on('entry',entry=>{
   if(++count>250||seen.has(entry.fileName)||entry.uncompressedSize>3*1024*1024||(total+=entry.uncompressedSize)>8*1024*1024||entry.isEncrypted()||/vbaProject|externalLinks|embeddings|\.bin$/i.test(entry.fileName))return bad(Error('Файл слишком сложный. Используйте пустой шаблон XLSX без макросов и внешних ссылок'));
   seen.add(entry.fileName);if(entry.fileName.endsWith('/'))return zip.readEntry();
   zip.openReadStream(entry,(error,stream)=>{if(error)return bad(error);let size=0;stream.on('data',chunk=>{size+=chunk.length;if(size>entry.uncompressedSize||size>3*1024*1024){stream.destroy();bad(Error('Превышен размер распакованного файла'))}});stream.on('error',bad);stream.on('end',()=>zip.readEntry());stream.resume()});
  });zip.readEntry();
 }));
}
async function parse(buffer){
 await inspectArchive(buffer);const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);
 const sheet=wb.getWorksheet('Аккаунты');if(!sheet)throw Error('Не найден лист «Аккаунты». Скачайте шаблон');
 if(sheet.rowCount>201||sheet.columnCount>6)throw Error('Допускается до 200 строк и только 6 столбцов шаблона');
 const text=(cell,email=false)=>{let value=cell.value;if(value===null)return '';if(value instanceof Date)throw Error('Excel преобразовал '+cell.address+' в дату. Скачайте новый шаблон и введите исходное значение заново');if(value&&typeof value==='object'&&('formula' in value||'sharedFormula' in value))throw Error('В ячейке '+cell.address+' должна быть строка текста, а не формула');if(email&&value&&typeof value==='object'&&typeof value.text==='string'&&typeof value.hyperlink==='string')value=value.text;/* Only visible email text is imported; hyperlink targets are never followed. */if(typeof value!=='string')throw Error('В ячейке '+cell.address+' должен быть текст');if(value.length>200)throw Error('Слишком длинное значение в '+cell.address);value=value.trim();return cell.row>1&&(cell.col===3||email)&&value.startsWith("'")?value.slice(1):value};
 if(headers.some((h,i)=>text(sheet.getCell(1,i+1))!==h))throw Error('Заголовки листа не совпадают с шаблоном');
 const rows=[];for(let r=2;r<=sheet.rowCount;r++){const values=headers.map((_,i)=>text(sheet.getCell(r,i+1),i===5));if(values.some(Boolean))rows.push({row:r,name:values[0],role:values[1],group:values[2],subgroup:values[3],institute:values[4],email:values[5]})}
 if(!rows.length)throw Error('В файле нет заполненных строк');return rows;
}
function style(sheet,widths){sheet.columns=widths.map(width=>({width}));sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF393365'}};sheet.getRow(1).height=26;sheet.views=[{state:'frozen',ySplit:1}];sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true}})}
async function template(data){
 const wb=new ExcelJS.Workbook();wb.creator='Орбита';const s=wb.addWorksheet('Аккаунты');s.addRow(headers);style(s,[40,22,24,18,30,38]);
 for(let c=1;c<=6;c++){s.getColumn(c).numFmt='@';for(let r=2;r<=201;r++)s.getCell(r,c).numFmt='@'}
 s.getCell('F1').note='Обязательный email. Он станет логином, сюда придёт временный пароль. Автоматическая почтовая ссылка допустима: импортируется только видимый адрес.';s.getCell('A1').note='Шаблон v2: C и F — текст с quotePrefix. Заполняйте строки начиная со второй. Только вымышленные данные для конкурса.';
 s.getCell('B1').note='Студент или Преподаватель';s.getCell('C1').note='Точное название существующей группы, например 1-40. Текстовый формат сохраняет дефисы и начальные нули. Вставляйте только значения, сохраняя формат шаблона.';s.getCell('E1').note='Код института с листа «Институты», только для преподавателя';
 for(let r=2;r<=201;r++)s.getCell('B'+r).dataValidation={type:'list',allowBlank:true,formulae:['"Студент,Преподаватель"']};
 const g=wb.addWorksheet('Группы');g.addRow(['Название группы','Институт','Программа']);data.groups.forEach(v=>g.addRow([v.name,v.faculty,v.program]));style(g,[25,65,65]);
 const i=wb.addWorksheet('Институты');i.addRow(['Код института','Название']);data.institutes.forEach(v=>i.addRow([v.id,v.name]));style(i,[30,90]);
 const h=wb.addWorksheet('Инструкция');h.addRow(['Импорт аккаунтов в Орбиту']);h.addRow(['Заполните лист «Аккаунты»: ФИО, роль, группа и необязательная подгруппа для студента; код института для преподавателя.']);h.addRow(['Группы нужно заранее создать и связать с программой МГСУ. Деканату доступны только закреплённые институты.']);h.addRow(['До 200 человек. Все поля имеют текстовый формат: группу 1-40 вводите как есть. Вставляйте только значения, сохраняя формат шаблона. Автоссылка email допустима; формулы и макросы запрещены.']);h.addRow(['Загрузите файл, проверьте строки, затем подтвердите создание. Email станет логином. Временный пароль будет отправлен каждому на его почту.']);style(h,[110]);h.getRows(2,4).forEach(r=>r.height=45);
 return addTextPrefixes(Buffer.from(await wb.xlsx.writeBuffer()));
}
try{
 let result;if(workerData.task==='parse')result=await parse(Buffer.from(workerData.buffer));
 else if(workerData.task==='template')result=await template(workerData.data);
 else if(workerData.task==='credentials')result=Array.from({length:workerData.count},()=>{const password=temporaryPassword(),salt=randomBytes(16).toString('hex');return {password,hash:salt+':'+scryptSync(password,salt,64).toString('hex')}});
 else throw Error('Неизвестная операция');parentPort.postMessage({ok:true,result});
}catch(e){parentPort.postMessage({ok:false,error:workerData.task==='parse'?String(e.message).slice(0,300):'Не удалось подготовить файл или пароли'})}
