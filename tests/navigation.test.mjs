import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {campusDirectory} from '../public/campus-ui.js';
import {appearanceView} from '../public/appearance-ui.js';

test('four main sections, nested navigation, personal results and role workspaces',async()=>{
 const navStates=new Map();
 const listeners={},nodes=new Map(),requests=[];let role='student', scrolls=0, delayedGrades;
 const me=()=>({id:1,role,name:'Проверочный студент',theme:'dark',grp:'Тест',course:1,login:'student@example.test'});
 const club=(id,title,membership)=>({id,title,membership,category:'Спорт',description:'Тест',weekday:2,start:'17:00',end:'18:00',place:'Зал',enrollment_open:1});
 const data={grades:[{subject:'Математика',score:'5',assessment:'Контрольная',date:'2026-11-10'}],attendance:[{subject:'Математика',status:'Присутствовал',date:'2026-11-10'}],clubs:[club(1,'Принятая секция','Вы приняты'),club(2,'Ожидающая секция','На рассмотрении'),club(3,'Свободный кружок',null)],events:[{id:1,title:'Команда университета',type:'Сборная',date:'2026-11-15T16:00',place:'Зал',description:'Тест'},{id:2,title:'Кубок университета',type:'Соревнование',date:'2026-11-15T16:00',place:'Зал',description:'Тест'}],requests:[{id:11,type:'Справка об обучении',status:'Принята',created:'2026-11-10',reply:''}],inbox:{requests:[],memberships:[]}};
 data['notices/unread']={unread:false};
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',style:{},querySelector(){return null},getAnimations(){return []},removeAttribute(k){delete this[k]},textContent:'',setAttribute(k,v){this[k]=v}});return nodes.get(key)};
 const context={console,Intl,Date,setTimeout:()=>0,clearTimeout(){},setInterval(){},clearCredentials(){},teachingView:async()=>'<h1>Оценки и посещаемость</h1><p>Назначенные группы</p>',managementView:()=>'<h1>Управление</h1>',staffRequestsView:(_,u)=>'<h1>Входящие</h1>'+u.role,syncInbox(){},window:{matchMedia(){return {matches:false}},addEventListener(){},scrollTo(){scrolls++}},document:{body:{dataset:{}},hidden:false,querySelector:node,querySelectorAll(){
   return [...new Set([...node('#app').innerHTML.matchAll(/data-page="([^"]+)"/g)].map(match=>match[1]))].map(id=>{
    const state={dataset:{page:id},active:false,setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]}};
    state.classList={toggle(_,active){state.active=active}};
    navStates.set(id,state);return state;
   });
  },addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn)},fetch:async(url,options={})=>{
  const endpoint=url.replace('/api/','');requests.push(endpoint);let result;
  if (endpoint==='grades' && delayedGrades) await delayedGrades.promise;
  if(endpoint==='me')result=me();else if(endpoint.startsWith('schedule?'))result={lessons:[],clubs:[],week:null};else if(endpoint==='manage')result={};else if(endpoint==='join'){const id=JSON.parse(options.body).club_id;data.clubs.find(c=>c.id===id).membership='На рассмотрении';result={ok:true}}else if(endpoint==='leave'){const id=JSON.parse(options.body).club_id;data.clubs.find(c=>c.id===id).membership=null;result={ok:true}}else result=data[endpoint];
  assert.notEqual(result,undefined,endpoint);return {ok:true,status:200,json:async()=>result};
 }};
 Object.assign(context,{campusDirectory,bindCampusDirectory(){}});
 Object.assign(context,{applyAppearance:()=>{},appearanceView,bindAppearance(){}});
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const state=await vm.runInNewContext('(async()=>{'+source+'\nreturn {async account(value){user=value;page="schedule";await render()}}})()',context);
 const click=async dataset=>{const button={dataset,disabled:false};for(const fn of listeners.click||[])await fn({target:{closest:()=>button}})};
 const content=()=>node('#content').innerHTML;
 function mainNav(expected){const markup=node('#app').innerHTML,nav=markup.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];assert.equal((nav.match(/<button/g)||[]).length,4);for(const title of ['Расписание','Оценки','Разное','Профиль'])assert.ok(nav.includes(title));assert.equal(navStates.get(expected).active,true);assert.equal(navStates.get(expected)['aria-current'],'page')}
 mainNav('schedule');
 const todayButton=()=>content().match(/<button [^>]*aria-current="date"[^>]*>/)[0];
 assert.match(todayButton(),/aria-pressed="true"/);
 const otherDate=content().match(/data-date="([^"]+)" aria-pressed="false"/)[1];
 await click({date:otherDate});
 assert.match(todayButton(),/aria-pressed="false"/);
 assert.ok(content().includes(`data-date="${otherDate}" aria-pressed="true"`));
 await click({shift:'7'});assert.doesNotMatch(content(),/aria-current="date"/);
 await click({action:'today'});assert.match(todayButton(),/aria-pressed="true"/);

 // A superseded response must not overwrite the current section or scroll it.
 delayedGrades=Promise.withResolvers();
 const slowNavigation=click({page:'grades'});
 mainNav('grades');assert.equal(node('#content')['aria-busy'],'true');
 await click({page:'extras'});
 const scrollsAfterSwitch=scrolls;
 delayedGrades.resolve();await slowNavigation;delayedGrades=null;
 mainNav('extras');assert.match(content(),/Справки/);
 assert.equal(scrolls,scrollsAfterSwitch);
 assert.equal(node('#content')['aria-busy'],undefined);
 await click({page:'profile'});mainNav('profile');
 assert.doesNotMatch(content(), /<form/);
 for(const [page, expected] of [['appearance',/Предпросмотр/], ['personal',/Курс/], ['emailSettings',/обратись в деканат/], ['passwordSettings',/data-password-change/]]) {
  await click({page});mainNav('profile');assert.match(content(), expected);assert.match(content(),/← Профиль/);
  await click({page:'profile'});
 }
 assert.match(node('#app').innerHTML,/href="#icon-grades"/);
 await click({page:'grades'});mainNav('grades');assert.match(content(),/Математика/);assert.match(content(),/5.00/);
 await click({gradeTab:'Посещаемость'});assert.match(content(),/Присутствовал/);assert.match(content(),/Пропусков: 0/);
 await click({page:'extras'});mainNav('extras');assert.match(content(),/Справки/);assert.match(content(),/Секции/);
 assert.match(content(),/data-page="campus"/);
 await click({page:'campus'});mainNav('extras');assert.match(content(),/Главный кампус НИУ МГСУ/);
 for(const code of ['kmk','kpa','sok','admin','ulk','ulb','library'])assert.ok(content().includes('data-open-map="'+code+'"'));
 assert.match(content(),/data-map-place="canteen"/);assert.doesNotMatch(content(),/data-map-place="sok"/);
 await click({page:'extras'});mainNav('extras');
 await click({page:'requests'});mainNav('extras');assert.match(content(),/← Разное/);assert.match(content(),/Справка об обучении/);assert.match(content(),/Принята/);
 await click({page:'clubs'});mainNav('extras');assert.match(content(),/Принятая секция/);assert.match(content(),/Мои заявки/);assert.match(content(),/Ожидающая секция/);assert.doesNotMatch(content(),/Свободный кружок/);
 await click({clubtab:'Сборные'});assert.match(content(),/Команда университета/);assert.match(content(),/Кубок университета/);
 await click({clubtab:'Кружки'});assert.match(content(),/Свободный кружок/);await click({join:'3'});assert.equal(data.clubs[2].membership,'На рассмотрении');
 await click({clubtab:'Мои занятия'});assert.match(content(),/Свободный кружок/);await click({leave:'3'});assert.doesNotMatch(content(),/Свободный кружок/);
 data.grades=[];data.attendance=[];await click({page:'grades'});assert.match(content(),/Отметок пока нет/);await click({gradeTab:'Оценки'});assert.match(content(),/Оценок пока нет/);
 for(const employee of ['teacher','staff','admin']){role=employee;await state.account(me());await click({page:'grades'});mainNav('grades');assert.match(content(),/Назначенные группы/);if(employee!=='teacher'){await click({page:'extras'});await click({page:'requests'});assert.match(content(),/Входящие/);await click({page:'profile'});assert.match(content(),/Панель управления/);await click({page:'manage'});mainNav('profile')}}
 role='manager';await state.account(me());await click({page:'extras'});assert.match(content(),/Записи в секции/);await click({page:'requests'});mainNav('extras');assert.match(content(),/Входящие/);
 assert.ok(requests.includes('attendance'));assert.ok(requests.includes('inbox'));
});
