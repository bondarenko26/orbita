import {applyAppearance, appearanceView, bindAppearance} from './appearance-ui.js';
import {clearCredentials} from './accounts-ui.js';
import {campusDirectory,bindCampusDirectory} from './campus-ui.js';
import {bindDating} from './dating-ui.js';
import {teachingView} from './teaching-ui.js';
import { managementView, staffRequestsView, syncInbox } from './management-ui.js';
const $=s=>document.querySelector(s),app=$('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const iso=d=>d.toISOString().slice(0,10),shift=(d,n)=>{let t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return iso(t)},fmt=(d,opts={day:'numeric',month:'long'})=>new Date(d+'T12:00:00Z').toLocaleDateString('ru-RU',opts);
let disposeBlocks=null;
let lastShownPage=null,lastShownDate=null;
let shellOwner=null;
const campusDrawing=()=>'<svg class="campus-drawing" viewBox="0 0 360 134" aria-hidden="true" focusable="false"><use href="#campus-elevation"></use></svg>';
let unread=false,noticeRevision=0;
let teacherId=null,teacherOrigin='teachers',teacherSearch='';
let user=null,page='schedule',selected=today(),mode='Пары',clubTab='Мои занятия',gradeTab='Оценки',showClubs=true,version=0;
const weekdays=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok){if(r.status===401&&path!=='login'){user=null;login()}throw Error(v.error)}return v}
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',3500)}
function login(){shellOwner=null;lastShownPage=null;lastShownDate=null;disposeBlocks?.();disposeBlocks=null;unread=false;noticeRevision++;teacherSearch='';clearCredentials();applyAppearance();app.innerHTML=`<main class="login"><div class="brand"><i class="logo"></i> ОРБИТА</div><div class="login-drawing">${campusDrawing()}</div><h1>Вход в кабинет</h1><p>Войдите с учётной записью, которую выдал деканат.</p><form id="login"><label>Email или прежний логин<input name="login" autocomplete="username" required autofocus></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><p class="error" role="alert"></p><button class="primary">Войти</button></form><footer>Конкурсный прототип · Неофициальный сервис<br>Все данные вымышлены. Аккаунт выдаёт администратор.</footer></main>`;$('#login').onsubmit=async e=>{e.preventDefault();let btn=e.target.querySelector('button');btn.disabled=true;try{user=await api('login',Object.fromEntries(new FormData(e.target)));selected=today();clubTab='Мои занятия';gradeTab='Оценки';page=['staff','manager'].includes(user.role)?'requests':'schedule';await render()}catch(e){$('.error').textContent=e.message}finally{btn.disabled=false}}}
const baseNav=[['schedule',uiIcon('schedule'),'Расписание'],['grades',uiIcon('grades'),'Оценки'],['extras',uiIcon('extras'),'Разное'],['profile',uiIcon('profile'),'Профиль']];
function navigation(){return baseNav}
function uiIcon(name){
 return `<svg class="ui-icon" width="24" height="24" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
}
function bellLabel(){return unread?'Уведомления, есть непрочитанные':'Уведомления'}
function bellButton(){
 return `<button class="bell-button" data-unread="${unread}" data-page="notices" aria-label="${bellLabel()}"><span class="bell-layer bell-read">${uiIcon('bell')}</span><span class="bell-layer bell-unread">${uiIcon('bell-active')}</span></button>`;
}
function applyBell(value,viewer,revision){
 if(user?.id!==viewer||revision!==noticeRevision)return;
 unread=value;
 const button=$('.bell-button');
 if(button){
  button.setAttribute('aria-label',bellLabel());
  button.dataset.unread=String(unread);
 }
}
async function refreshBell(){
 if(!user||user.must_change_password||document.hidden)return;
 const viewer=user.id,revision=++noticeRevision;
 try{const result=await api('notices/unread');applyBell(result.unread,viewer,revision)}catch{/* Retry when the tab becomes active or on the next poll. */}
}
setInterval(refreshBell,15000);
window.addEventListener('focus',refreshBell);
document.addEventListener('visibilitychange',refreshBell);
function activeSection(){return ({blocks:'extras',dating:'extras',datingAdmin:'extras',contacts:'extras',campus:'extras',appearance:'profile',personal:'profile',emailSettings:'profile',passwordSettings:'profile',support:'profile',supportInbox:'profile',teachers:'extras',teacherCard:teacherOrigin==='schedule'?'schedule':'extras',requests:'extras',clubs:'extras',teaching:'grades',manage:'profile',trash:'profile',mailStatus:'profile',notices:'profile'})[page]||page}
function shell(){applyAppearance(user);if(shellOwner===user.id+':'+user.role && $('.shell')){updateNavigation();return;}shellOwner=user.id+':'+user.role;app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><i class="logo"></i> ОРБИТА</div><div><div class="side-label">Личный кабинет</div><nav class="nav">${navigation().map(navButton).join('')}${['admin','staff','manager'].includes(user.role)?navButton(['manage',uiIcon('manage'),'Управление']):''}</nav></div><footer>Цифровой деканат будущего<br>Конкурсный концепт · 2026<br>Все данные вымышлены</footer></aside><main class="main"><header class="top"><span class="eyebrow">Кампус / ${esc(user.grp||(user.role==='student'?'Студент':'Сотрудник'))}</span><div class="top-actions">${bellButton()}<button data-page="profile" class="avatar" aria-label="Профиль">${uiIcon('profile')}</button></div></header><div id="content" aria-live="polite"><p class="loading">Загружаем…</p></div><p class="banner">Конкурсный прототип · Все данные вымышлены</p></main><nav class="mobile-nav" aria-label="Основные разделы"><span class="nav-drop" aria-hidden="true"></span>${navigation().map(navButton).join('')}</nav></div>`;updateNavigation(false)}

function updateNavigation(animate = true) {
 const section = activeSection();
 document.querySelectorAll('.nav button, .mobile-nav button').forEach(button => {
  const active = button.dataset.page === 'manage' ? page === 'manage' : button.dataset.page === section;
  button.classList.toggle('active', active);
  if (active) button.setAttribute('aria-current', 'page');
  else button.removeAttribute('aria-current');
 });
 moveNavDrop(animate);
}
function moveNavDrop(animate = true) {
 const nav = $('.mobile-nav'), drop = nav?.querySelector('.nav-drop');
 const active = nav?.querySelector('button.active');
 if (!drop || !active || !nav.offsetWidth) return;
 const previous = drop.getBoundingClientRect();
 const width = Math.min(68, active.offsetWidth - 8);
 const left = active.offsetLeft + (active.offsetWidth - width) / 2;
 const oldSection = drop.dataset.section;
 drop.getAnimations().forEach(animation => animation.cancel());
 drop.style.width = width + 'px';
 drop.style.left = left + 'px';
 drop.dataset.section = active.dataset.page;
 if (!animate || !oldSection || oldSection === active.dataset.page || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
 const offset = previous.left - drop.getBoundingClientRect().left;
 drop.animate([
  {transform: 'translateX(' + offset + 'px) scaleX(1)'},
  {transform: 'translateX(' + offset * .35 + 'px) scaleX(1.32)', offset: .45},
  {transform: 'translateX(0) scaleX(.96)', offset: .82},
  {transform: 'translateX(0) scaleX(1)'}
 ], {duration: 380, easing: 'cubic-bezier(.22,.7,.25,1)'});
}
window.addEventListener('resize', () => moveNavDrop(false));
function navButton([id,icon,label]){const active=page===id||(id!=='manage'&&activeSection()===id);return `<button data-page="${id}" class="${active?'active':''}" ${active?'aria-current="page"':''}><span class="icon" aria-hidden="true">${icon}</span>${label}</button>`}
const heading=(title,sub,extra='')=>`<div class="heading"><div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;
const empty=(title,sub,action='')=>`<div class="empty"><div class="symbol">◌</div><h3>${title}</h3><p>${sub}</p>${action}</div>`;
async function render(){
 disposeBlocks?.();disposeBlocks=null;
 if(!user)return login();
 if(user.must_change_password)return forcePassword();
 const v=++version;shell();if(page!=='notices')refreshBell();
 try{
  const view=({blocks:()=>'<div class="blocks-root" data-blocks></div>',schedule,grades,extras,dating,datingAdmin:dating,contacts,campus,support,supportInbox,teachers,teacherCard,requests,clubs,profile,personal,appearance,emailSettings,passwordSettings,notices,manage,teaching,trash,mailStatus})[page]||schedule;
  const html=await view(),content=$('#content');
  if(v!==version||!content)return;

  content.setAttribute('aria-live', page === 'blocks' ? 'off' : 'polite');
  const previousContent = content.innerHTML;
  const pageChanged = page !== lastShownPage;
  content.getAnimations().forEach(animation => animation.cancel());
  if (previousContent && lastShownPage && pageChanged && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
   await content.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}],
    {duration:100,easing:'ease-out',fill:'forwards'}).finished.catch(()=>{});
   if(v!==version)return;
  }
  content.getAnimations().forEach(animation => animation.cancel());
  content.removeAttribute('data-arrival');
  content.removeAttribute('data-week-change');
  if (page === 'schedule' && lastShownPage === page && lastShownDate && weekStart(selected) !== weekStart(lastShownDate)) {
   content.setAttribute('data-week-change', 'true');
  }
  content.innerHTML=html;

  if (page!==lastShownPage && page!=='blocks') content.setAttribute('data-arrival','page');
  else if (page==='schedule' && selected!==lastShownDate) content.setAttribute('data-arrival',selected>lastShownDate?'later':'earlier');
  lastShownPage=page;
  if(page==='schedule') lastShownDate=selected;
  if (page==='blocks') {
   content.setAttribute('aria-live','off');
   const {mountBlocks}=await import('./blocks-game.js');
   if (v!==version || !content.isConnected) return;
   disposeBlocks=mountBlocks(content.querySelector('[data-blocks]'), 'account-'+user.id, ()=>{
    page='extras';render();window.scrollTo({top:0,behavior:'instant'});
   });
  }
  if(page==='appearance') {
   const owner = user.id;
   bindAppearance($('[data-appearance]'), async values => {
    await api('theme', values);
    if (user?.id !== owner) return;
    Object.assign(user, values);
    applyAppearance(user);
    toast('Оформление сохранено');
   });
  }
  if(page==='campus')bindCampusDirectory($('[data-campus-guide]'));
  if(page==='dating'||page==='datingAdmin')bindDating($('[data-dating]'),{admin:page==='datingAdmin',api,esc,uiIcon,toast});
 }catch(e){if(v===version&&$('#content'))$('#content').innerHTML=empty('Не удалось загрузить',esc(e.message),'<button data-action="refresh">Повторить</button>')}
}
function weekStart(date) {
 const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
 return shift(date, -((weekday + 6) % 7));
}
async function schedule(){const {lessons,clubs,week}=await api('schedule?date='+selected);const mon=weekStart(selected);let list=lessons.filter(l=>mode==='Пары'?!['Экзамен','Зачёт','Консультация'].includes(l.kind):['Экзамен','Зачёт','Консультация'].includes(l.kind));if(showClubs&&mode==='Пары')list.push(...clubs.map(c=>({...c,subject:c.title,kind:'Секция',room:c.place,teacher:'Ваша секция',club:true})));list.sort((a,b)=>a.start.localeCompare(b.start));let cards='',prev=null;for(const l of list){if(prev&&prev.status!=='cancelled'&&l.status!=='cancelled'&&mins(l.start)-mins(prev.end)>=45){let n=mins(l.start)-mins(prev.end);cards+=`<div class="gap"><span>◷</span>Окно ${Math.floor(n/60)?Math.floor(n/60)+' ч ':''}${n%60?n%60+' мин':''}</div>`}cards+=`<article class="lesson ${l.kind==='Практика'?'practice':l.kind==='Лабораторная'||l.club?'lab':''}"><div class="lesson-time"><strong>${esc(l.start)}</strong><span>${esc(l.end)}</span></div><div><h3>${esc(l.subject)}</h3><div class="meta">${l.room ? `<span class="lesson-room">${uiIcon('campus')}${esc(l.room)}</span>` : ''}<span class="lesson-kind">${esc(l.kind)}</span></div><p class="teacher">${l.teacher_id?`<button class="teacher-link" data-teacher="${l.teacher_id}">${esc(l.teacher_name||l.teacher)}</button>`:esc(l.teacher)}${l.group_name?' · '+esc(l.group_name):''}</p>${l.change?`<p class="change-notice">${esc(l.change)}</p>`:''}${l.status==='cancelled'?'<span class="badge">Отменено</span>':''}${!l.club&&user.role==='student'?`<button class="note" data-note="${l.id}" data-value="${esc(l.note||'')}">${l.note?esc(l.note).slice(0,90):'Добавить заметку'}</button>`:''}</div></article>`;prev=l}
return '<header class="schedule-cover">'+campusDrawing()+heading('Расписание',`${fmt(selected,{weekday:'long',day:'numeric',month:'long'})} · ${esc(user.grp||(user.role==='teacher'?'Мои занятия':user.role==='student'?'Группа пока не назначена':'Расписание групп — в управлении'))}`)+'</header>'+`<div class="schedule-layout"><section><div class="segmented">${['Пары','Сессия'].map(m=>`<button data-mode="${m}" class="${mode===m?'active':''}">${m}</button>`).join('')}</div><div class="weekbar"><div><strong>${week===null?'Семестр ещё не настроен':week>0?week+'-я неделя · '+(week%2?'нечётная':'чётная'):'До начала семестра'}</strong><small>${fmt(mon)} — ${fmt(shift(mon,6))}</small></div><div class="week-actions"><button data-action="today">Сегодня</button><button data-shift="-7" aria-label="Предыдущая неделя">‹</button><button data-shift="7" aria-label="Следующая неделя">›</button></div></div><div class="days">${Array.from({length:7},(_,i)=>{let d=shift(mon,i);return `<button class="day ${d===selected?'active':''} ${d===today()?'today':''}" data-date="${d}" aria-pressed="${d===selected}"><span>${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i]}</span><strong>${Number(d.slice(-2))}</strong></button>`}).join('')}</div><label class="checkline"><input type="checkbox" id="showClubs" ${showClubs?'checked':''}>Показывать мои секции</label><div class="agenda-list">${cards||empty('Занятий нет',mode==='Пары'?'На выбранный день занятий нет.':'На этот день экзаменов и зачётов нет.','<button data-shift="1">Следующий день →</button>')}</div></section><aside class="aside"><div class="aside-card"><span class="eyebrow">Твой день</span><div class="big">${list.length}</div><h3>${list.length?'занятий в расписании':'время для себя'}</h3><p>${list.length?esc(list[0].start)+' — '+esc(list.at(-1).end):'Можно подготовиться к следующей неделе или найти новое увлечение.'}</p></div><div class="aside-card"><h3>Кружки и секции</h3><p>Расписание занятий и запись в кружки.</p><button class="link-button" data-page="clubs" data-section="Кружки">Найти кружок</button></div><div class="aside-card"><h3>Справки</h3><p>Закажи справку и следи за её готовностью прямо здесь.</p><button class="link-button" data-page="requests">Перейти к справкам</button></div></aside></div>`}
const mins=t=>Number(t.split(':')[0])*60+Number(t.split(':')[1]);
async function grades(){
 if(['teacher','staff','admin'].includes(user.role))return teaching();
 const [g,attendance]=await Promise.all([api('grades'),api('attendance')]);
 const tabs=`<nav class="section-tabs" aria-label="Результаты учёбы">${['Оценки','Посещаемость'].map(t=>`<button data-grade-tab="${t}" aria-pressed="${gradeTab===t}" class="${gradeTab===t?'active':''}">${t}</button>`).join('')}</nav>`;
 let body;if(gradeTab==='Оценки'){
  const numeric=g.filter(x=>['2','3','4','5'].includes(x.score)),avg=numeric.length?(numeric.reduce((sum,x)=>sum+Number(x.score),0)/numeric.length).toFixed(2):'—';
  body=`<div class="card row"><div><span class="eyebrow">Средний балл</span><p>По выставленным оценкам</p></div><strong class="score">${avg}</strong></div><div class="list manage-section">${g.map(x=>`<article class="card row"><div><h3>${esc(x.subject)}</h3><p>${esc(x.assessment)} · ${fmt(x.date)}</p></div><strong class="score">${esc(x.score)}</strong></article>`).join('')||empty('Оценок пока нет','Здесь появятся результаты по дисциплинам.')}</div>`;
 }else{
  const marked=attendance.filter(a=>a.status!=='Не отмечено');
  body=`<div class="card"><h2>Посещаемость</h2><p>Всего отметок: ${marked.length} · Пропусков: ${marked.filter(a=>a.status==='Отсутствовал').length}</p><small>Отсутствие отметки не считается пропуском.</small></div><div class="list manage-section">${attendance.map(a=>`<article class="card"><h3>${esc(a.subject)}</h3><p>${fmt(a.date)} · ${esc(a.status)}</p></article>`).join('')||empty('Отметок пока нет','Посещаемость появится после заполнения журнала преподавателем.')}</div>`;
 }return heading('Оценки','Результаты по дисциплинам и посещаемость')+tabs+body;
}
const backToExtras=()=>'<button class="back-link" data-page="extras">← Разное</button>';

async function support(){return supportPage(false)}
async function supportInbox(){return supportPage(true)}
async function supportPage(inbox){
 const tickets=await api(inbox?'support/inbox':'support');
 const back='<button class="back-link" data-page="profile">← Профиль</button>';
 const tabs=user.role==='admin'?`<nav class="section-tabs" aria-label="Техподдержка">
 <button data-page="support" class="${inbox?'':'active'}" aria-pressed="${!inbox}">Мои обращения</button>
 <button data-page="supportInbox" class="${inbox?'active':''}" aria-pressed="${inbox}">Входящие</button></nav>`:'';
 const cards=tickets.map(t=>`<article class="card support-ticket">
 <small>№ ${t.id} · ${fmt(t.created.slice(0,10))}</small> <span class="badge">${t.reply?'Есть ответ':'Ожидает ответа'}</span>
 <h3>${esc(t.subject)}</h3>${inbox?`<small>${esc(t.author)}</small>`:''}
 <p class="request-detail">${esc(t.message)}</p>
 ${t.reply?`<h4>Ответ техподдержки</h4><p class="request-detail">${esc(t.reply)}</p>`:
 inbox?`<button data-support-reply="${t.id}">Ответить</button>`:''}</article>`).join('');
 return back+heading('Техподдержка',inbox?'Обращения пользователей кабинета':'Сообщи о проблеме в работе кабинета')+tabs+
 (inbox?'':'<button class="primary" data-action="support-new">Написать в поддержку</button>')+
 '<div class="list manage-section">'+(cards||empty(inbox?'Входящих обращений пока нет':'Обращений пока нет',inbox?'Здесь появятся вопросы пользователей.':'Здесь будут твои обращения и ответы поддержки.'))+'</div>';
}
function supportDialog(){
 modal('Написать в поддержку','<label>Тема<input name="subject" required maxlength="120"></label><label>Что произошло?<textarea name="message" required maxlength="2000" placeholder="В каком разделе возникла проблема?"></textarea></label>',
 values=>api('support',values),'Отправить');
}
function replyDialog(id){
 modal('Ответ на обращение №'+Number(id),'<label>Ответ пользователю<textarea name="reply" required maxlength="2000"></textarea></label>',
 values=>api('support/'+id+'/reply',values),'Отправить');
}

function stars(value){
 const filled=Math.round(value);
 return '<span class="rating-stars" aria-hidden="true">'+'★'.repeat(filled)+'☆'.repeat(5-filled)+'</span>';
}
function ratingSummary(teacher){
 if(!teacher.count)return '<span class="muted">Пока нет оценок</span>';
 const word=new Intl.PluralRules('ru').select(teacher.count);
 const label=({one:'оценка',few:'оценки'})[word]||'оценок';
 return stars(teacher.average)+' <span>'+teacher.average.toLocaleString('ru',{maximumFractionDigits:1})+' из 5 · '+teacher.count+' '+label+'</span>';
}
const normalizeName=name=>name.toLocaleLowerCase('ru').replaceAll('ё','е');
async function teachers(){
 const directory=(await api('teachers')).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
 const header=backToExtras()+heading('Преподаватели','Рейтинги и отзывы студентов');
 if(!directory.length)return header+empty('Преподавателей пока нет','Здесь появятся преподаватели, зарегистрированные в кабинете.');
 const search=normalizeName(teacherSearch.trim());
 const matches=name=>normalizeName(name).includes(search);
 return header+`<label>Поиск по ФИО<input type="search" id="teacher-search" value="${esc(teacherSearch)}"></label>
 <div class="list">${directory.map(t=>`<button class="teacher-entry" data-teacher="${t.id}" data-name="${esc(normalizeName(t.name))}" ${matches(t.name)?'':'hidden'}>
 <strong>${esc(t.name)}</strong><span class="rating-summary">${ratingSummary(t)}</span></button>`).join('')}</div>
 <p id="teacher-no-matches" role="status" ${directory.some(t=>matches(t.name))?'hidden':''}>По этому запросу преподавателей нет.</p>`;
}
document.addEventListener('input',e=>{
 if(e.target.id!=='teacher-search')return;
 teacherSearch=e.target.value;
 const search=normalizeName(teacherSearch.trim());
 let visible=0;
 for(const card of document.querySelectorAll('.teacher-entry')){
  card.hidden=!card.dataset.name.includes(search);
  if(!card.hidden)visible++;
 }
 $('#teacher-no-matches').hidden=visible>0;
});
function reviewText(review){
 return `<div class="rating-summary">${stars(review.rating)} <span>${review.rating} из 5</span></div>`+
 (review.comment?`<p class="review-comment">${esc(review.comment)}</p>`:'');
}
async function teacherCard(){
 const {teacher,mine,comments}=await api('teachers/'+teacherId);
 const back=teacherOrigin==='schedule'?'К расписанию':'К преподавателям';
 const ownCard=mine?`<section class="card"><h2>Мой отзыв</h2>${reviewText(mine)}
 <div class="review-actions"><button data-review-action="edit" data-rating="${mine.rating}" data-value="${esc(mine.comment)}">Изменить</button>
 <button data-review-action="delete">Удалить</button></div></section>`:'';
 return `<button class="back-link" data-page="${teacherOrigin}">← ${back}</button>`+
 heading(esc(teacher.name),'Преподаватель')+`<div class="list">
 <section class="card"><h2>Рейтинг студентов</h2><div class="rating-summary">${ratingSummary(teacher)}</div>
 ${!mine&&user.role==='student'?'<button class="primary" data-review-action="create">Оставить отзыв</button>':''}</section>
 ${ownCard}<h2>Анонимные отзывы</h2>
 ${comments.map(r=>'<article class="card">'+reviewText(r)+'</article>').join('')||
 '<p class="muted">'+(mine?'Других комментариев пока нет.':'Комментариев пока нет.')+'</p>'}</div>`;
}
function reviewDialog(button){
 const endpoint='teachers/'+teacherId;
 if(button.dataset.reviewAction==='delete'){
  modal('Удалить свой отзыв?','<p>Ваша оценка и комментарий будут удалены. Средний балл пересчитается.</p>',()=>api(endpoint+'/delete-my-review',{}),'Удалить');
  return;
 }
 const selected=Number(button.dataset.rating);
 const options=[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" required value="${n}" aria-label="${n} из 5" ${n===selected?'checked':''}><span aria-hidden="true">★</span></label>`).join('');
 modal(selected?'Изменить отзыв':'Оставить отзыв',`<fieldset class="star-picker"><legend>Ваша оценка</legend>${options}</fieldset>
 <label>Комментарий (по желанию)<textarea name="comment" maxlength="2000" placeholder="Что помогает учиться? Что можно улучшить?">${esc(button.dataset.value||'')}</textarea></label>
 <p class="muted">Отзыв публикуется анонимно. Чтобы сохранить анонимность, опустите имя и группу.</p>`,
 values=>api(endpoint+'/my-review',{rating:Number(values.rating),comment:values.comment}),selected?'Сохранить':'Опубликовать');
}
function serviceCard(target,icon,title,description){return `<button class="service-card" data-page="${target}"><span class="service-icon" aria-hidden="true">${uiIcon(icon)}</span><span class="service-copy"><strong>${title}</strong><span>${description}</span></span></button>`}
function campus(){return backToExtras()+campusDirectory(uiIcon('campus'))}
function dating(){return backToExtras()+'<div data-dating><p class="loading">Загружаем…</p></div>'}
async function extras(){
 const staff=['admin','staff'].includes(user.role);
 const study=[
  user.role==='student'||staff?serviceCard('requests','documents','Справки',staff?'Заявки и готовые документы':'Заказ и статус заявки'):'',
  serviceCard('campus','campus','Карта МГСУ','Корпуса и схема кампуса'),
  serviceCard('teachers','teachers','Преподаватели','Рейтинги и отзывы'),
  serviceCard('clubs','clubs','Секции','Занятия, кружки и сборные'),
  serviceCard('contacts','contacts','Контакты','Телефоны и почта администрации'),
 ].join('');
 const coach=user.role==='manager'?'<h2 class="services-label">Управление секциями</h2><div class="services-grid">'+serviceCard('requests','clubs','Записи в секции','Заявки на ваши занятия')+'</div>':'';
 const leisure=serviceCard('blocks','blocks','Игра Блоки','Собирай линии и ставь рекорды')+(user.role==='student'?serviceCard('dating','heart','Знакомства','Найти друзей и компанию в МГСУ · 18+'):user.role==='admin'?serviceCard('datingAdmin','heart','Модерация знакомств','Жалобы, спорные анкеты и пересмотр'):'');
 return '<h1>Разное</h1><h2 class="services-label">Учёба</h2><div class="services-grid">'+study+'</div>'+coach+(leisure?'<h2 class="services-label">Развлечения</h2><div class="services-grid">'+leisure+'</div>':'');
}
const admissionsSource='https://mgsu.ru/postupayushchim/Kontakty/';
const universityContacts=[
 {name:'Канцелярия',purpose:'Письменные обращения и корреспонденция',phone:'+7 (495) 781-80-07',email:'kanz@mgsu.ru',source:'https://os.mgsu.ru/contacts/Priem_korrespond/'},
 {name:'Объединённая дирекция общежитий',purpose:'Вопросы заселения и проживания',phone:'+7 (499) 929-50-16',email:'odo@mgsu.ru',source:'https://mgsu.ru/student/Obshegitiya/kontakti.php'},
 {name:'Приёмная комиссия',purpose:'Приём граждан России',phone:'+7 (495) 781-99-88',ext:'5',email:'priemkom@mgsu.ru',source:admissionsSource},
 {name:'Приём иностранных граждан',purpose:'Вопросы поступления из-за рубежа',phone:'+7 (499) 929-50-12',email:'international@mgsu.ru',source:admissionsSource},
];
function contacts(){
 const cards=universityContacts.map(c=>{
  const dial=c.phone.replace(/[^+\d]/g,'')+(c.ext?';ext='+c.ext:'');
  return `<article class="card department-contact"><h2>${c.name}</h2><p>${c.purpose}</p>
   <a href="tel:${dial}">${c.phone}${c.ext?' доб. '+c.ext:''}</a>
   <a href="mailto:${c.email}">${c.email}</a>
   <a class="contact-source" href="${c.source}" target="_blank" rel="noopener noreferrer">На сайте МГСУ ↗</a></article>`;
 }).join('');
 return backToExtras()+heading('Контакты','Телефоны и электронная почта подразделений МГСУ')+'<div class="grid">'+cards+'</div>';
}
async function requests(){if(['staff','admin','manager'].includes(user.role))return backToExtras()+staffRequestsView(await api('inbox'),user);if(user.role!=='student')return backToExtras()+heading('Справки','Документы и заявления')+empty('Раздел для студентов','Студенческие справки заказываются из аккаунта студента.');const rs=await api('requests');return backToExtras()+heading('Справки','Деканат рядом. Без очередей и потерянных сообщений.')+`<button class="primary" data-action="request">＋ Новая заявка</button><div class="list manage-section">${rs.map(r=>`<article class="card"><div class="row"><span class="badge">${esc(r.status)}</span><small>№ ${r.id}</small></div><h3>${esc(r.type)}</h3><p>${esc(r.comment||'Без дополнительного комментария')}</p>${r.has_document?`<p><a class="download" href="/api/requests/${r.id}/document">Скачать справку ↓</a></p>`:''}${r.reply?`<p class="request-detail">Ответ деканата: ${esc(r.reply)}</p>`:''}<small>${esc(r.created)}</small><p>Принята → В работе → Готова</p></article>`).join('')||empty('Здесь будут твои заявки','Закажи справку или отправь обращение — статус появится здесь.')}</div>`}
async function clubs(){
 const [cs,events]=await Promise.all([api('clubs'),api('events')]);
 const clubCard=c=>`<article class="card"><span class="badge">${esc(c.category)}</span><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><p>◷ ${weekdays[c.weekday]} · ${esc(c.start)}–${esc(c.end)}<br>⌖ ${esc(c.place)}</p>${c.membership?`<span class="badge">${esc(c.membership)}</span><div class="club-actions"><button data-leave="${c.id}">Отменить запись</button></div>`:user.role==='student'?`<div class="club-actions"><button data-join="${c.id}" ${!c.enrollment_open?'disabled':''}>${c.enrollment_open?'Записаться →':'Набор закрыт'}</button></div>`:''}</article>`;
 const eventCards=type=>events.filter(e=>e.type===type).map(e=>`<article class="card"><span class="badge">${esc(e.type)}</span><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><p>◷ ${new Date(e.date).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК<br>⌖ ${esc(e.place)}</p></article>`).join('');
 let body;if(clubTab==='Сборные')body='<h2 class="section-title">Сборные университета</h2><div class="grid">'+(eventCards('Сборная')||empty('Сборные пока не добавлены','Здесь появятся команды университета.'))+'</div><h2 class="section-title">Соревнования</h2><div class="grid">'+(eventCards('Соревнование')||empty('Соревнований пока нет','Здесь появятся даты и места проведения.'))+'</div>';
 else if(clubTab==='Кружки')body='<div class="grid">'+(cs.map(clubCard).join('')||empty('Занятия пока не добавлены','Здесь появятся спортивные секции и творческие кружки.'))+'</div>';
 else {const mine=cs.filter(c=>c.membership==='Вы приняты'),pending=cs.filter(c=>c.membership&&c.membership!=='Вы приняты');body='<div class="grid">'+(mine.map(clubCard).join('')||empty('Выберите занятие по душе','После подтверждения записи оно появится здесь и в расписании.','<button data-clubtab="Кружки">Найти занятие →</button>'))+'</div>'+(pending.length?'<h2 class="section-title">Мои заявки</h2><div class="grid">'+pending.map(clubCard).join('')+'</div>':'')}
 return backToExtras()+heading('Секции','Занятия, команды и события кампуса')+`<nav class="section-tabs section-tabs-three" aria-label="Разделы секций">${['Мои занятия','Сборные','Кружки'].map(t=>`<button data-clubtab="${t}" aria-pressed="${t===clubTab}" class="${t===clubTab?'active':''}">${t}</button>`).join('')}</nav>`+body;
}
const backToProfile = () => '<button class="back-link" data-page="profile">← Профиль</button>';
const profileRoles = {student:'Студент', teacher:'Преподаватель', admin:'Администратор', manager:'Руководитель секций', staff:'Сотрудник деканата'};

async function profile() {
 const current = await api('me');
 user = current;
 if (current.must_change_password) return forcePassword();
 const cards = [
  serviceCard('personal', 'profile', 'Личные данные', 'Учебный профиль и роль'),
  serviceCard('appearance', 'palette', 'Оформление', 'Тема, шрифт, размер и цвет'),
  serviceCard('emailSettings', 'contacts', 'Логин и почта', 'Адрес для входа'),
  serviceCard('passwordSettings', 'lock', 'Пароль', 'Изменить пароль для входа'),
  serviceCard('support', 'support', 'Техподдержка', 'Обращения и ответы'),
 ].join('');
 const work = [];
 if (['admin','staff','manager'].includes(user.role)) work.push(serviceCard('manage','manage','Панель управления','Работа с записями'));
 if (user.role !== 'student') work.push(serviceCard('trash','archive','Удалённые записи','Просмотр и восстановление'));
 return `<h1>Мой профиль</h1><p class="profile-identity">${esc(user.name)} · ${esc(profileRoles[user.role])}</p>
  <div class="services-grid">${cards}</div>
  ${work.length ? '<h2 class="services-label">Рабочие разделы</h2><div class="services-grid">'+work.join('')+'</div>' : ''}
  <div class="profile-actions"><button data-action="logout">Выйти из аккаунта</button></div>`;
}
function personal() {
 const details = [['ФИО',user.name],['Роль',profileRoles[user.role]]];
 if (user.education?.length) details.push(['Обучение',user.education.map(node=>node.name).join(' · ')]);
 else details.push(['Факультет / институт',user.faculty],['Направление',user.program]);
 if (user.role==='student') details.push(['Курс',user.course],['Группа',user.grp],['Подгруппа',user.subgroup]);
 if (user.staff_institutes?.length) details.push(['Институты',user.staff_institutes.join(', ')]);
 return backToProfile()+'<h1>Личные данные</h1><dl class="card personal-details">'+
  details.filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')+'</dl>';
}
function appearance() { return backToProfile()+appearanceView(user); }
function passwordSettings() {
 return backToProfile()+heading('Пароль','После смены пароля остальные устройства выйдут из аккаунта.')+
  '<section class="card profile-detail">'+passwordForm(false)+'</section>';
}
function emailSettings() {
 const forms = ['admin','staff'].includes(user.role) ? `<p>Новая почта станет логином после подтверждения кодом. Старые сеансы завершатся.</p>
  <form data-email-request><label>Новый email<input name="email" type="email" autocomplete="email" required></label><label>Текущий пароль<input name="current_password" type="password" autocomplete="current-password" required></label><button class="primary">Получить код</button><p class="error" role="status"></p></form>
  <form data-email-confirm><label>Код из письма<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><button>Подтвердить email</button><p class="error" role="status"></p></form>` :
  '<p>Для смены логина обратись в деканат.</p>';
 return backToProfile()+'<h1>Логин и почта</h1><section class="card profile-detail"><h2>'+esc(user.login)+'</h2>'+forms+'</section>';
}
async function notices(){const viewer=user.id,seq=++noticeRevision;const ns=await api('notices');applyBell(ns.some(n=>!n.is_read),viewer,seq);return heading('Уведомления','Изменения и ответы, которые важно не пропустить')+`<button data-action="read">Отметить всё прочитанным</button><div class="list manage-section">${ns.map(n=>`<article class="card"><small>${n.is_read?'Прочитано':'● Новое'}</small><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join('')||empty('Пока тихо','Новые уведомления появятся здесь.')}</div>`}
const field=(name,label,type='text',value='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" required></label>`;
const select=(name,label,options)=>`<label>${label}<select name="${name}">${options.map(o=>{let [v,n]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}">${esc(n)}</option>`}).join('')}</select></label>`;
const form=(title,endpoint,fields)=>`<details class="card"><summary>${title}</summary><form data-endpoint="${endpoint}">${fields}<button class="primary">Сохранить</button></form></details>`;
async function teaching(){return teachingView(api)}
async function manage(){return backToProfile()+managementView(await api('manage'),user,api)}
function modal(title,fields,onSubmit,actionLabel='Сохранить'){$('#modal-content').innerHTML=`<h2>${title}</h2><form id="modal-form">${fields}<p class="error" role="alert"></p><div class="form-actions"><button type="button" data-action="close">Отмена</button><button class="primary">${esc(actionLabel)}</button></div></form>`;$('#modal').showModal();$('#modal-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('.primary');b.disabled=true;try{const result=await onSubmit(Object.fromEntries(new FormData(e.target)));$('#modal').close();toast(result?.mail_queued?'Временный пароль поставлен в очередь отправки':actionLabel==='Удалить'?'Запись удалена':'Сохранено');await render()}catch(e){$('#modal-form .error').textContent=e.message}finally{b.disabled=false}}}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.supportReply){replyDialog(b.dataset.supportReply)}else if(b.dataset.action==='support-new'){supportDialog()}else if(b.dataset.teacher){teacherOrigin=page==='schedule'?'schedule':'teachers';teacherId=Number(b.dataset.teacher);page='teacherCard';await render();window.scrollTo({top:0,behavior:'instant'})}else if(b.dataset.reviewAction){reviewDialog(b)}else if(b.dataset.changeEmail){modal('Сменить email-логин','<label>Новый email<input type="email" name="email" required></label><label>Ваш текущий пароль сотрудника<input type="password" name="current_password" autocomplete="current-password" required></label><p>Старые сеансы владельца завершатся. На новый email будет отправлен новый временный пароль.</p>',v=>api('accounts/email',{...v,id:Number(b.dataset.changeEmail)}))}else if(b.dataset.recordDelete){modal('Удалить запись?','<p>Запись исчезнет из кабинета. Её можно восстановить в разделе «Удалённые».</p>',()=>api('records/'+b.dataset.recordDelete+'/delete',{id:Number(b.dataset.recordId)}),'Удалить')}else if(b.dataset.recordRestore){await api('records/'+b.dataset.recordRestore+'/restore',{id:Number(b.dataset.recordId)});await render()}else if(b.dataset.resetPassword){b.disabled=true;try{const result=await api('accounts/reset',{id:Number(b.dataset.resetPassword)});toast('Временный пароль поставлен в очередь отправки на email')}finally{b.disabled=false}}else if(b.dataset.page){page=b.dataset.page;if(b.dataset.section)clubTab=b.dataset.section;await render();window.scrollTo({top:0,behavior:'instant'})}else if(b.dataset.gradeTab){gradeTab=b.dataset.gradeTab;await render()}else if(b.dataset.date){selected=b.dataset.date;await render()}else if(b.dataset.shift){selected=shift(selected,Number(b.dataset.shift));await render()}else if(b.dataset.mode){mode=b.dataset.mode;await render()}else if(b.dataset.clubtab){clubTab=b.dataset.clubtab;await render()}else if(b.dataset.note){const id=Number(b.dataset.note);modal('Личная заметка','<label>Видна только тебе<textarea name="text" maxlength="2000">'+esc(b.dataset.value)+'</textarea></label>',v=>api('notes',{lesson_id:id,date:selected,text:v.text}))}else if(b.dataset.leave){await api('leave',{club_id:Number(b.dataset.leave)});toast('Запись отменена');await render()}else if(b.dataset.join){b.disabled=true;await api('join',{club_id:Number(b.dataset.join)});toast('Заявка отправлена руководителю');await render()}else switch(b.dataset.action){case 'today':selected=today();await render();break;case 'refresh':await render();break;case 'close':$('#modal').close();break;case 'logout':await api('logout',{});user=null;login();break;case 'request':modal('Новая заявка',select('type','Что нужно',['Справка об обучении','Справка о стипендии','Заявление в деканат'])+'<label>Комментарий<textarea name="comment" maxlength="2000" placeholder="Уточни назначение или расскажи о своей ситуации"></textarea></label>',v=>api('requests',v));break;case 'read':await api('notices/read',{});await render();break}}catch(e){toast(e.message);b.disabled=false}});
document.addEventListener('change',e=>{if(e.target.id==='showClubs'){showClubs=e.target.checked;render()}});
document.addEventListener('submit',async e=>{if(!e.target.dataset.endpoint)return;e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{const result=await api(e.target.dataset.endpoint,Object.fromEntries(new FormData(e.target)));toast('Сохранено');await render();if(result.mail_queued)toast('Временный пароль поставлен в очередь отправки на email')}catch(e){toast(e.message)}finally{btn.disabled=false}});
try{user=await api('me');if(['staff','manager'].includes(user.role))page='requests';await render()}catch{login()}

document.addEventListener('management-tab-change',()=>{if(page==='manage')render()});
let inboxBusy=false;
async function refreshInbox(){
 if(inboxBusy||document.hidden||!user||!['staff','admin','manager'].includes(user.role)||!$('[data-live-inbox]'))return;
 inboxBusy=true;const uid=user.id,renderVersion=version;
 try{const data=await api('inbox');if(user?.id===uid&&version===renderVersion&&$('[data-live-inbox]'))syncInbox(data)}catch(e){document.querySelectorAll('[data-inbox-sync]').forEach(el=>el.textContent='Не удалось обновить: '+e.message)}finally{inboxBusy=false}
}
setInterval(refreshInbox,5000);
document.addEventListener('visibilitychange',refreshInbox);
window.addEventListener('focus',refreshInbox);

function passwordForm(forced){return '<form data-password-change><label>'+ (forced?'Временный пароль':'Текущий пароль')+'<input type="password" name="current_password" autocomplete="current-password" required maxlength="200"></label><label>Новый пароль<input type="password" name="new_password" autocomplete="new-password" required minlength="8" maxlength="14"></label><label>Повторите новый пароль<input type="password" name="confirm_password" autocomplete="new-password" required minlength="8" maxlength="14"></label><p class="muted">8–14 символов, минимум 3 латинские буквы и заглавная латинская буква или спецсимвол. Без пробелов.</p><p class="error" role="alert"></p><button class="primary">'+(forced?'Сменить пароль и войти':'Сменить пароль')+'</button></form>'}
function forcePassword(){shellOwner=null;applyAppearance(user);app.innerHTML='<main class="login"><div class="brand"><i class="logo"></i> ОРБИТА</div><h1>Задайте свой пароль</h1><p>Вы вошли с временным паролем. Смените его, чтобы открыть кабинет.</p>'+passwordForm(true)+'<div class="profile-actions"><button data-action="logout">Выйти из аккаунта</button></div></main>';return ''}
document.addEventListener('submit',async e=>{const form=e.target;if(!form.hasAttribute('data-password-change'))return;e.preventDefault();const button=form.querySelector('button'),error=form.querySelector('.error');error.textContent='';button.disabled=true;try{user=await api('password',Object.fromEntries(new FormData(form)));await render();toast('Пароль изменён. Другие сеансы завершены.')}catch(err){if(error.isConnected)error.textContent=err.message}finally{button.disabled=false}});
window.addEventListener('pagehide',clearCredentials);

async function trash(){const rows=await api('trash');const names={groups:'Группа',users:'Аккаунт',lessons:'Занятие',clubs:'Секция',events:'Сборная / соревнование',grades:'Оценка'};return backToProfile()+heading('Удалённые записи','Восстановление доступно в пределах ваших прав')+'<div class="list">'+rows.map(r=>'<article class="card"><span class="badge">'+names[r.table]+'</span><h3>'+esc(r.label)+'</h3><p>'+esc(new Date(r.date).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))+' МСК'+'</p><button data-record-restore="'+r.table+'" data-record-id="'+r.id+'">Восстановить</button></article>').join('')+(rows.length?'':'<p>Удалённых записей нет.</p>')+'</div>'}
document.addEventListener('submit',async e=>{const f=e.target;if(!f.hasAttribute('data-email-request')&&!f.hasAttribute('data-email-confirm'))return;e.preventDefault();const button=f.querySelector('button'),error=f.querySelector('.error');button.disabled=true;try{const confirm=f.hasAttribute('data-email-confirm'),r=await api('email/'+(confirm?'confirm':'request'),Object.fromEntries(new FormData(f)));if(confirm){user=await api('me');await render();toast('Email и логин изменены')}else error.textContent=r.message}catch(err){error.textContent=err.message}finally{button.disabled=false}});

async function mailStatus(){const r=await api('mail/status');return heading('Отправка писем',r.configured?'SMTP настроен':'Отправка пока не настроена')+'<p>'+ (r.configured?'Пароли отправляются автоматически после создания аккаунтов. Ниже показан результат передачи почтовому серверу.':'Для создания аккаунтов с email требуется настроить SMTP на сервере.')+'</p><div class="list">'+(r.jobs||[]).map(j=>'<article class="card"><h3>'+esc(j.recipient)+'</h3><p>'+esc(({pending:'В очереди',sending:'Отправляется',sent:'Передано почтовому серверу',failed:'Ошибка отправки',cancelled:'Отменено'})[j.state]||j.state)+' · '+esc(new Date(j.created+'Z').toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))+' МСК'+'</p><p>'+esc(j.error||'')+'</p></article>').join('')+(r.jobs.length?'':'<p class="muted">Писем пока нет.</p>')+'</div>'}
