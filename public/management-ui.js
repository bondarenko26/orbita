import {importView} from './accounts-ui.js';
import {registerTeacherPicker} from './teacher-picker.js';
let callApi;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current='lessons',snapshot=null,actor=null;
registerTeacherPicker(()=>snapshot?.teachers||[]);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Moscow'});
const option=(v,label,value)=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(label)}</option>`;
function programPath(value,data){
 const nodes=data.catalog||[],path=[];let n=nodes.find(n=>n.id===value);while(n){path.unshift(n);n=nodes.find(p=>p.id===n.parent_id)}
 return '<fieldset class="program-picker"><legend>Структура МГСУ</legend><input type="hidden" name="program_id" value="'+esc(value||'')+'">'+['institute','form','level','direction','program'].map((kind,i)=>{
 const parent=path[i-1]?.id;const list=nodes.filter(n=>n.kind===kind&&(i===0?data.scopes.includes(n.id):n.parent_id===parent));
 return '<label>'+['Институт / филиал','Форма обучения','Уровень образования','Направление','Программа / профиль'][i]+'<select data-program-level="'+i+'" required><option value="">Выберите</option>'+list.map(n=>option(n.id,n.name+(n.status.includes('verification')?' · требует проверки':''),path[i]?.id)).join('')+'</select></label>';
 }).join('')+'<small>ИДО и аспирантура пока неполные. Курсы и группы не заполнены автоматически.</small></fieldset>';
}
function field(f,value,data,key){
 if(f.type==='teacher_search'){
  const id='lesson-teacher-'+key, chosen=data.teachers.find(t=>String(t.id)===String(value));
  return `<teacher-picker><label for="${id}">Преподаватель</label><div class="teacher-input">
   <input id="${id}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" autocomplete="off" placeholder="Выберите или введите фамилию" value="${esc(chosen?.name)}" required>
   <button type="button" aria-label="Список преподавателей" aria-controls="${id}-list" aria-expanded="false" tabindex="-1">▾</button>
   <input type="hidden" name="teacher_id" value="${esc(chosen?.id)}">
   <div class="teacher-popup" inert><div id="${id}-list" role="listbox" aria-label="Преподаватели"></div><span class="teacher-empty" role="status"></span></div>
  </div></teacher-picker>`;
 }if(f.type==='program_path')return programPath(value,data);const optional=!!f.optional,req=optional?'':'required';let options=f.options;if(f.type==='group')options=data.groups.map(g=>[g.name,g.name]);if(f.type==='student')options=data.students.map(s=>[s.id,s.name+' · '+s.grp]);if(f.type==='owner')options=data.owners.map(u=>[u.id,u.name]);
 if(f.type==='group_id')options=data.groups.map(g=>[g.id,g.name]);
 if(f.type==='institute')options=(data.catalog||[]).filter(n=>n.kind==='institute'&&data.scopes.includes(n.id)).map(n=>[n.id,n.name]);
 if(f.type==='teacher')options=(data.teachers||[]).map(n=>[n.id,n.name]);
 if(f.type==='staff')options=(data.staff||[]).map(n=>[n.id,n.name]);
 if(f.type==='assignment')options=(data.assignments||[]).map(n=>[n.id,n.group_name+' · '+n.subject+' · '+n.teacher_name+' · '+n.semester+(n.active?'':' · закрыто')]);
 let control;if(options)control=`<select name="${f.name}" ${req}>${optional?option('','Не выбрано',value):f.type==='group_id'?option('','Выберите группу',value):''}${options.map(o=>Array.isArray(o)?option(o[0],o[1],value):option(o,o,value)).join('')}</select>`;
 else if(f.type==='textarea')control=`<textarea name="${f.name}" ${req} maxlength="8000">${esc(value)}</textarea>`;
 else control=`<input name="${f.name}" ${f.readonly?'readonly':''} type="${f.type}" value="${esc(value)}" ${req} ${f.type==='password'?'minlength="8" maxlength="14" autocomplete="new-password"':f.type==='number'?'min="1"':''}>`;
 if(['date','time','datetime-local'].includes(f.type)){
  control=`<span class="temporal-control">${control}</span>`;
 }
 return `<label>${esc(f.label)}${control}</label>`;
}
function editor(entity,schema,row,data){const config=data.settings;const defaults={course:1,active:1,archived:0,enrollment_open:1,capacity:20,day:1,weekday:1,parity:'all',start:'09:00',end:'10:20',term_start:config?.semester_start||today(),term_end:config?.semester_end||today(),owner:actor.id};const values={...defaults,...row};
 if(row && entity==='lessons'){
  const assigned=data.assignments.find(a=>a.id===row.assignment_id);
  values.group_id=assigned?.group_id??data.groups.find(g=>g.name===row.grp)?.id;
  values.teacher_id=assigned?.teacher_id;
 }
 if(entity==='teaching_assignments' && row?.from_schedule)return '<p class="muted">Назначение создано из расписания. Преподавателя и группу можно изменить в карточке пары.</p>';
 return `<form data-endpoint="manage/${entity}" class="editor">${row?`<input name="id" type="hidden" value="${row.id}">`:''}<div class="editor-grid">${schema.fields.map(f=>field({...f,readonly:!!row&&entity==='users'&&f.name==='login'},f.name==='password'?'':values[f.name]??'',data,row?.id||'new')).join('')}</div><button class="primary">${row?'Сохранить изменения':'Создать запись'}</button>${entity==='users'?'<p class="muted">Новый или заданный заново пароль временный: при входе его нужно сменить. Логин — email. Пустой пароль будет сгенерирован и отправлен на эту почту. Пароль: 8–14 символов, 3 латинские буквы, заглавная буква или спецсимвол.</p>':''}${entity==='users'&&row&&row.id!==actor.id?`<button type="button" data-reset-password="${row.id}">Выдать новый временный пароль</button><button type="button" data-change-email="${row.id}">Сменить email-логин</button>`:''}${row&&['groups','users','lessons','clubs','events','grades'].includes(entity)&&!(entity==='users'&&row.id===actor.id)?`<button type="button" class="danger" data-record-delete="${entity}" data-record-id="${row.id}">Удалить</button>`:''}</form>`}
function label(row,entity,data){if(entity==='settings')return 'Период обучения';if(entity==='staff_scopes')return (data.staff.find(s=>s.id===row.user_id)?.name||'Сотрудник')+' · '+(data.catalog.find(n=>n.id===row.institute_id)?.name||'Институт');if(entity==='teaching_assignments')return (data.teachers.find(t=>t.id===row.teacher_id)?.name||'Преподаватель')+' · '+row.subject+' · '+(data.groups.find(g=>g.id===row.group_id)?.name||'Группа');if(entity==='grades')return (data.students.find(s=>s.id===row.user_id)?.name||'Студент')+' · '+row.subject;return row.title||row.name||row.subject||'Запись'}
function sub(row,entity){if(entity==='lessons')return `${row.grp}${row.subgroup?' / '+row.subgroup:''} · ${row.date||['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][row.day]} · ${row.start}–${row.end} · ${row.room}${row.teacher?' · '+row.teacher:''}${row.archived?' · В архиве':''}`;if(entity==='clubs')return `${row.place} · ${['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][row.weekday]} ${row.start}–${row.end}${row.archived?' · В архиве':''}`;if(entity==='users')return `${row.login} · ${row.grp||row.role}${row.active?'':' · Заблокирован'}`;if(entity==='grades')return `${row.assessment} · ${row.score} · ${row.date}`;if(entity==='teaching_assignments')return row.semester+' · '+row.start_date+' — '+row.end_date+(row.active?'':' · закрыто');return row.date||row.faculty||row.semester_start||''}
function exceptions(data){const lessons=data.entities.lessons?.rows.filter(l=>!l.archived)||[];return `<h2>Перенос одного занятия</h2><p class="muted">Изменяется только выбранная дата. Остальные недели сохраняются.</p><details class="card"><summary>＋ Перенести или отменить</summary><form data-endpoint="manage/exceptions"><div class="editor-grid">${field({name:'lesson_id',label:'Занятие',options:lessons.map(l=>[l.id,l.grp+' · '+l.subject+' · '+l.start+' · '+['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][l.day]])},'',data)}${field({name:'original_date',label:'Исходная дата',type:'date'},today(),data)}${field({name:'cancelled',label:'Действие',options:[[0,'Перенести / изменить'],[1,'Отменить']]},0,data)}${field({name:'new_date',label:'Новая дата (при отмене — исходная)',type:'date'},today(),data)}${field({name:'start',label:'Начало',type:'time'},'09:00',data)}${field({name:'end',label:'Окончание',type:'time'},'10:20',data)}${field({name:'room',label:'Аудитория',type:'text'},'',data)}${field({name:'reason',label:'Причина изменения',type:'text'},'',data)}</div><button class="primary">Применить и уведомить</button></form></details><div class="list">${data.exceptions.map(x=>`<article class="card"><h3>${esc(x.subject)} · ${esc(x.grp)}</h3><p>${esc(x.original_date)} → ${x.cancelled?'Отменено':esc(x.new_date)+' '+esc(x.start)}<br>${esc(x.reason)}</p></article>`).join('')}</div>`}
function requests(data){return `<div class="row"><h2>Заявки студентов · ${data.requests.length}</h2><button data-action="refresh">Обновить</button></div><p id="inbox-sync" data-inbox-sync class="muted">Новые заявки появляются автоматически. Введённый ответ сохраняется на экране.</p><div id="inbox-list" data-live-inbox="requests" class="list manage-section">${data.requests.map(r=>`<details class="card" data-inbox-id="${r.id}"><summary>№ ${r.id} · ${esc(r.type)} · ${esc(r.status)}<span class="record-sub">${esc(r.name)}</span></summary><p class="request-detail">${esc(r.comment||'Без комментария')}</p><form data-endpoint="manage/requests"><input name="id" type="hidden" value="${r.id}">${field({name:'status',label:'Статус',options:['Принята','В работе','Нужно уточнение','Готова']},r.status,data)}${field({name:'reply',label:'Ответ студенту',type:'textarea',optional:true},r.reply,data)}${field({name:'document',label:'Текст готовой справки (скачивается студентом как документ)',type:'textarea',optional:true},r.document||'',data)}<p class="muted">Справка готова к скачиванию только после статуса «Готова». В конкурсной версии документ помечен как образец.</p><button class="primary">Сохранить и уведомить</button></form></details>`).join('')||'<p class="muted" data-inbox-empty>Заявок пока нет.</p>'}</div>`}
function memberships(data){return '<div class="row"><h2>Запись в секции · '+data.memberships.length+'</h2><button data-action="refresh">Обновить</button></div><p data-inbox-sync class="muted">Заявки на ваши секции обновляются автоматически.</p><div data-live-inbox="memberships" class="list manage-section">'+data.memberships.map(m=>`<details class="card" data-inbox-id="${m.id}"><summary>${esc(m.name)} · ${esc(m.status)}<span class="record-sub">${esc(m.title)}</span></summary><form data-endpoint="manage/memberships"><input name="id" type="hidden" value="${m.id}">${field({name:'status',label:'Статус',options:['На рассмотрении','Вы приняты','Набор закрыт']},m.status,data)}<button class="primary">Сохранить и уведомить</button></form></details>`).join('')+(data.memberships.length?'':'<p class="muted" data-inbox-empty>Заявок на ваши секции пока нет.</p>')+'</div>'}
function view(data){const tabs=Object.entries(data.entities).map(([k,v])=>[k,v.title]);if(data.entities.users)tabs.push(['import','Импорт Excel']);if(data.entities.lessons)tabs.push(['exceptions','Переносы'],['requests','Заявки']);if(data.entities.clubs)tabs.push(['memberships','Записи в секции']);if(data.entities.users)tabs.push(['mail','Отправка писем']);if(actor.role==='admin')tabs.push(['audit','Журнал действий']);if(!tabs.some(t=>t[0]===current))current=tabs[0][0];let body;
 if(current==='mail')body='<h2>Отправка писем</h2><button data-page="mailStatus">Открыть состояние отправки</button>';else if(current==='import')body=importView(callApi);else if(current==='exceptions')body=exceptions(data);else if(current==='requests')body=requests(data);else if(current==='memberships')body=memberships(data);else if(current==='audit')body=`<h2>Последние 100 действий</h2><div class="list manage-section">${data.audit.map(a=>`<article class="card"><strong>${esc(a.name)}</strong><p>${esc(({create:'Создание',update:'Изменение',status:'Изменение статуса',exception:'Перенос или отмена',import:'Импорт аккаунта',password_reset:'Выдан временный пароль',password_change:'Смена пароля',email_change:'Смена email',delete:'Удаление',restore:'Восстановление'})[a.action]||a.action)} · ${esc(data.entities[a.entity]?.title||({requests:'Заявка',memberships:'Запись в секцию'})[a.entity]||a.entity)} № ${a.record_id}</p><small>${esc(a.created)} UTC</small></article>`).join('')||'<p>Действий пока нет</p>'}</div>`;else {const schema=data.entities[current];body=`<div class="row"><h2>${esc(schema.title)}</h2><span class="pill">${schema.rows.length} записей</span></div>${!schema.singleton?`<details class="card create-card"><summary>＋ Добавить</summary>${editor(current,schema,null,data)}</details><label>Найти запись<input id="management-search" type="search" placeholder="Название, группа или имя"></label>`:''}<div class="list manage-section">${schema.rows.map(r=>`<details class="card managed-record" data-search="${esc((label(r,current,data)+' '+sub(r,current)).toLowerCase())}"><summary>${esc(label(r,current,data))}<span class="record-sub">${esc(sub(r,current))}</span></summary>${editor(current,schema,r,data)}</details>`).join('')||'<p class="muted">Записей пока нет. Создайте первую.</p>'}</div>`}
 return `<div class="heading"><div><h1>Управление</h1><p>НИУ МГСУ · данные заполняются ответственными сотрудниками</p>${actor.role==='staff'&&!data.scopes.length?'<p class="error">Администратор пока не назначил вам институт. Обратитесь к нему для выдачи прав.</p>':''}</div></div><nav class="management-tabs" aria-label="Разделы управления"><div class="management-track">${tabs.map(([k,v])=>`<button aria-controls="management-section" aria-pressed="${k===current}" data-manage-tab="${k}" class="${current===k?'active':''}">${esc(v)}</button>`).join('')}<management-indicator aria-hidden="true"></management-indicator></div></nav><section id="management-section">${body}</section>`}
export function managementView(data,user,api){snapshot=data;actor=user;callApi=api;return view(data)}
// Management tabs wrap and have different widths. Clip one surface to the selected button.
class ManagementIndicator extends HTMLElement {
 connectedCallback() {
  this.observer = new ResizeObserver(() => this.align(true));
  this.observer.observe(this.parentElement);
  for (const button of this.parentElement.querySelectorAll('button')) this.observer.observe(button);
  this.align(true);
 }
 disconnectedCallback() { this.observer?.disconnect(); }
 align(instant) {
  const button = this.parentElement?.querySelector('[aria-pressed=true]');
  if (!button) return;
  const x = button.offsetLeft, y = button.offsetTop;
  const shape = `inset(${y}px calc(100% - ${x+button.offsetWidth}px) calc(100% - ${y+button.offsetHeight}px) ${x}px round 16px)`;
  if (shape === this.shape) return;
  this.shape = shape;
  this.toggleAttribute('data-instant', instant);
  this.style.clipPath = shape;
 }
}
customElements.define('management-indicator', ManagementIndicator);

document.addEventListener('click',event=>{
 const button = event.target.closest('[data-manage-tab]');
 if (!button || !snapshot || button.dataset.manageTab === current) return;
 current = button.dataset.manageTab;
 const nav = button.closest('.management-tabs');
 for (const tab of nav.querySelectorAll('button')) {
  tab.classList.toggle('active', tab === button);
  tab.setAttribute('aria-pressed', String(tab === button));
 }
 const keyboard = event.detail === 0;
 nav.querySelector('management-indicator').align(keyboard);
 document.dispatchEvent(new CustomEvent('management-tab-change',{detail:{keyboard}}));
});
document.addEventListener('input',e=>{if(e.target.id!=='management-search')return;const q=e.target.value.toLowerCase();document.querySelectorAll('.managed-record').forEach(r=>r.hidden=!r.dataset.search.includes(q))});

export function staffRequestsView(data,user){
 return '<div class="heading"><div><h1>Входящие</h1><p>'+ (user.role==='manager'?'Запись студентов в ваши секции':'Обращения студентов')+'</p></div></div>'+
 (['staff','admin'].includes(user.role)?'<section class="inbox-group">'+requests(data)+'</section>':'')+
 (['manager','admin'].includes(user.role)?'<section class="inbox-group">'+memberships(data)+'</section>':'');
}
export function syncInbox(data){
 for(const list of document.querySelectorAll('[data-live-inbox]')){
 const kind=list.dataset.liveInbox,rows=data[kind]||[],template=document.createElement('template');
 template.innerHTML=kind==='memberships'?memberships({memberships:rows}):requests({requests:rows});
 const next=template.content.querySelector('[data-live-inbox]'),ids=new Set(rows.map(r=>String(r.id)));
 for(const old of list.querySelectorAll('[data-inbox-id]'))if(!ids.has(old.dataset.inboxId))old.remove();
 for(const fresh of [...next.querySelectorAll('[data-inbox-id]')].reverse()){
 const existing=list.querySelector('[data-inbox-id="'+fresh.dataset.inboxId+'"]');
 if(!existing){list.querySelector('[data-inbox-empty]')?.remove();list.prepend(fresh)}
 else if(!existing.open&&!existing.contains(document.activeElement)&&!existing.querySelector('[data-dirty]')&&existing.innerHTML!==fresh.innerHTML)existing.replaceWith(fresh);
 }
 if(!rows.length&&!list.querySelector('[data-inbox-empty]'))list.append(next.querySelector('[data-inbox-empty]'));
 const header=list.previousElementSibling.previousElementSibling.querySelector('h2');if(header)header.textContent=(kind==='memberships'?'Запись в секции':'Заявки студентов')+' · '+rows.length;
 const hint=list.previousElementSibling;if(hint)hint.textContent='Обновлено '+new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК. Открытая форма не перезаписывается.';
 }
}
function markInboxDirty(e){const f=e.target.closest('form[data-endpoint="manage/requests"],form[data-endpoint="manage/memberships"]');if(f)f.dataset.dirty='true'}
document.addEventListener('input',markInboxDirty);
document.addEventListener('change',markInboxDirty);

document.addEventListener('change',e=>{
 if(!e.target.matches('[data-program-level]'))return;const picker=e.target.closest('.program-picker'),level=Number(e.target.dataset.programLevel),selects=[...picker.querySelectorAll('select')];
 for(let i=level+1;i<selects.length;i++){const parent=selects[i-1].value;const children=parent?snapshot.catalog.filter(n=>n.parent_id===parent):[];selects[i].innerHTML='<option value="">Выберите</option>'+children.map(n=>option(n.id,n.name,'')).join('')}
 picker.querySelector('[name="program_id"]').value=selects.at(-1).value;
});
