const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let preview=null,apiCall;
export function clearCredentials(){preview=null}
export function importView(call){apiCall=call;preview=null;return `<h2>Импорт аккаунтов из Excel</h2><p>Для студентов и преподавателей. Логином станет email из таблицы. Временный пароль отправится каждому человеку на его почту.</p><ol><li>Скачайте шаблон с доступными группами и институтами.</li><li>Заполните лист «Аккаунты». Группы должны быть созданы заранее. Используйте только вымышленные данные.</li><li>Загрузите файл и проверьте все строки перед созданием.</li></ol><p><a class="download" href="/api/accounts/template" download>Скачать шаблон XLSX ↓</a></p><form id="account-upload" class="card"><label>Заполненный файл Excel<input type="file" name="file" accept=".xlsx" required></label><p class="muted">До 200 человек и 1 МБ. Столбец Email обязателен. Пароли добавлять не нужно.</p><button class="primary">Проверить файл</button><p class="error" role="alert"></p></form><div id="import-preview" aria-live="polite"></div>`}
const base64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Не удалось прочитать файл'));reader.readAsDataURL(file)});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='account-upload')return;e.preventDefault();preview=null;const form=e.target,file=form.elements.file.files[0],button=form.querySelector('button'),error=form.querySelector('.error'),area=document.querySelector('#import-preview');error.textContent='';area.innerHTML='';button.disabled=true;
 try{if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>1024*1024)throw Error('Выберите .xlsx размером до 1 МБ');area.innerHTML='<p class="loading">Проверяем файл…</p>';const result=await apiCall('accounts/preview',{file_name:file.name,file:await base64(file)});if(!area.isConnected)return;preview=result;
 area.innerHTML=`<h3>${result.valid?'Всё готово к созданию':'Исправьте ошибки в файле'} · ${result.count}</h3><p>${result.valid?'Ни один аккаунт ещё не создан. Проверка действительна 15 минут.':'Аккаунты не созданы. Исправьте строки и загрузите файл повторно.'}</p><div class="list">${result.rows.map(r=>`<article class="card"><strong>Строка ${r.row} · ${esc(r.name)}</strong><p>${esc(r.role)} · ${esc(r.group||r.institute)}${r.subgroup?' · '+esc(r.subgroup):''}</p><small>Логин: ${esc(r.login)}</small>${r.errors.map(err=>`<p class="error">${esc(err)}</p>`).join('')}</article>`).join('')}</div>${result.valid?`<button class="primary" data-import-commit>Создать аккаунты (${result.count})</button>`:''}<p id="import-result" role="status"></p>`;
 }catch(err){error.textContent=err.message;area.innerHTML=''}finally{button.disabled=false}
});
document.addEventListener('change',e=>{if(e.target.matches('#account-upload input[type="file"]')){preview=null;const area=document.querySelector('#import-preview');if(area)area.innerHTML=''}});
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-import-commit')){
  if(!preview?.valid)return;b.disabled=true;const status=document.querySelector('#import-result');status.textContent='Создаём аккаунты…';
  try{const result=await apiCall('accounts/commit',{token:preview.token});preview=null;if(status.isConnected){status.textContent=`Создано аккаунтов: ${result.count}.`;b.remove();status.textContent+=' Временные пароли поставлены в очередь отправки на email.'}}catch(err){status.textContent=err.message;b.disabled=false}
 }
});
