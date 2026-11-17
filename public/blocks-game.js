import {SIDE, shapes, newRound, place, fits, validRound, isOver} from './blocks-engine.js';

const icons = {
 back:'<path d="m14 5-7 7 7 7"/>', pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
 sound:'<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 mute:'<path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>',
 trophy:'<path d="M7 3h10v6a5 5 0 0 1-10 0zm0 2H3v2q0 5 5 5m9-7h4v2q0 5-5 5m-4 2v5m-4 2h8"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">'+icons[name]+'</svg>';
const format = n => n.toLocaleString('ru-RU');

function miniature(piece) {
 const shape=shapes[piece.id], node=document.createElement('span');
 node.className='bl-mini bl-c'+piece.color;
 node.style.setProperty('--w',shape.w);node.style.setProperty('--h',shape.h);
 for (const [x,y] of shape.cells) {
  const tile=document.createElement('b');
  tile.style.gridColumn=x+1;tile.style.gridRow=y+1;node.append(tile);
 }
 return node;
}

export function mountBlocks(root, namespace='guest', exit) {
 const key='orbita.blocks.v1.'+namespace;
 let saved={};
 try {saved=JSON.parse(localStorage.getItem(key))||{};} catch {}
 let best=Number.isSafeInteger(saved.best)&&saved.best>=0?saved.best:0;
 let round=validRound(saved.round)?saved.round:null;
 let previousBest=Number.isSafeInteger(saved.previousBest)?saved.previousBest:best;
 let sound=saved.sound!==false, screen='menu', selected=null, drag=null, audio=null;
 let cursor={x:0,y:0}, frame=0, scoreFrame=0, suppressClick=false, scoreShown=round?.score||0;
 let returnTo='menu';
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const lifetime=new AbortController();
 root.classList.add('blocks-root');
 root.innerHTML=`<div class="bl-frame">
  <div class="bl-toolbar"><button class="bl-back" data-bl="back">${icon('back')}${exit?'Разное':'Меню'}</button>
  <div class="bl-tools"><button class="bl-icon" data-bl="audio"></button><button class="bl-icon" data-bl="pause" aria-label="Пауза">${icon('pause')}</button></div></div>
  <div class="bl-hud"><div><small>Счёт</small><strong class="bl-score">0</strong></div><div class="bl-best">${icon('trophy')}<div><small>Рекорд</small><strong>0</strong></div></div></div>
  <div class="bl-field"><div class="bl-board" tabindex="0" role="group" aria-label="Игровое поле 8 на 8. Стрелки выбирают место, Enter ставит фигуру."></div><div class="bl-burst" aria-hidden="true"></div></div>
  <div class="bl-tray" role="group" aria-label="Доступные фигуры"></div>
  <p class="bl-tip">Перетащи фигуру или нажми на неё, а затем на поле.</p>
 </div><div class="bl-overlay"></div><span class="visually-hidden" role="status" data-bl-status></span>`;
 const get = selector=>root.querySelector(selector);
 const board=get('.bl-board'), tray=get('.bl-tray'), layer=get('.bl-overlay'), fx=get('.bl-burst'), score=get('.bl-score');
 const cells=Array.from({length:64},()=>{const cell=document.createElement('div');cell.className='bl-cell';board.append(cell);return cell;});
 const slots=Array.from({length:3},(_,i)=>{const button=document.createElement('button');button.className='bl-slot';button.dataset.slot=i;tray.append(button);return button;});

 function persist() {
  try {
   const other=JSON.parse(localStorage.getItem(key));
   if (Number.isSafeInteger(other?.best)) best=Math.max(best,other.best);
  } catch {}
  try {localStorage.setItem(key,JSON.stringify({best,previousBest,round,sound}));} catch {}
 }
 function tone(kind) {
  if (!sound) return;
  try {
   audio ||= new AudioContext();
   if (audio.state==='suspended') audio.resume().catch(()=>{});
   const notes=kind==='combo'?[523,659,784,1046]:kind==='line'?[523,698,880]:[310];
   notes.forEach((freq,i)=>{
    const osc=audio.createOscillator(), gain=audio.createGain(), t=audio.currentTime+i*.065;
    osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,t);
    gain.gain.exponentialRampToValueAtTime(.085,t+.012);gain.gain.exponentialRampToValueAtTime(.0001,t+.17);
    osc.connect(gain);gain.connect(audio.destination);osc.start(t);osc.stop(t+.18);
   });
  } catch {}
 }
 function animate(node, keys, duration) {
  if (reduced.matches) return;
  return node.animate(keys,{duration,easing:'ease-out'});
 }
 function displayScore(value, smooth) {
  cancelAnimationFrame(scoreFrame);
  const start=performance.now(), initial=scoreShown;
  function draw(now) {
   const t=smooth&&!reduced.matches?Math.min(1,(now-start)/260):1;
   scoreShown=Math.round(initial+(value-initial)*(1-(1-t)**3));score.textContent=format(scoreShown);
   if (t<1) scoreFrame=requestAnimationFrame(draw);
  }
  draw(start);
 }
 function paint(smooth=false) {
  cells.forEach((cell,index)=>{
   const color=round?.board[index]||0;
   cell.innerHTML=color?'<i class="bl-tile bl-c'+color+'"></i>':'';
   cell.classList.remove('bl-target','bl-invalid');
  });
  slots.forEach((button,i)=>{
   button.replaceChildren();
   const piece=round?.hand[i];
   button.disabled=!piece;button.setAttribute('aria-pressed',String(selected===i));
   if (piece) {
    const shape=shapes[piece.id];
    button.append(miniature(piece));button.setAttribute('aria-label',`Фигура ${i+1}, ${shape.w} на ${shape.h}, блоков: ${shape.cells.length}`);
   } else button.setAttribute('aria-label','Пустое место');
  });
  displayScore(round?.score||0,smooth);
  get('.bl-best strong').textContent=format(best);
  const audioButton=get('[data-bl=audio]');
  audioButton.innerHTML=icon(sound?'sound':'mute');audioButton.setAttribute('aria-label',sound?'Выключить звук':'Включить звук');
  audioButton.setAttribute('aria-pressed',String(sound));
 }
 function clearHint() {
  board.querySelectorAll('.bl-target').forEach(cell=>cell.classList.remove('bl-target','bl-invalid'));
 }
 function hint(slot,x,y) {
  clearHint();
  const shape=shapes[round.hand[slot].id], ok=fits(round.board,shape,x,y);
  shape.cells.forEach(([dx,dy])=>{
   const col=x+dx,row=y+dy;
   if (col>=0&&row>=0&&col<SIDE&&row<SIDE) {
    const cell=cells[row*SIDE+col];cell.classList.add('bl-target');cell.classList.toggle('bl-invalid',!ok);
   }
  });
  return ok;
 }
 function cancelDrag() {
  cancelAnimationFrame(frame);frame=0;
  if (drag) {
   const {button,id,ghost}=drag;drag=null;ghost?.remove();
   if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
  }
  clearHint();
 }
 function menu(target) {
  cancelDrag();screen=target;get('.bl-frame').inert=target!=='play';
  layer.hidden=target==='play';layer.replaceChildren();
  if (target==='play') {board.focus({preventScroll:true});return;}
  const canResume=round&&!isOver(round);
  const newRecord=round && round.score>previousBest;
  const button=(action,label,primary=false)=>`<button class="${primary?'bl-cta':'bl-alt'}" data-bl="${action}">${label}</button>`;
  let title='',copy='',actions='';
  if (target==='menu') {
   title='Игра Блоки';copy='Заполняй ряды и столбцы, чтобы освободить поле.';
   actions=(canResume?button('resume','Продолжить',true):'')+button('start','Новая игра',!canResume)+button('record','Лучший результат');
  } else if (target==='pause') {
   title='Пауза';copy='Счёт · '+format(round.score);
   actions=button('resume','Продолжить',true)+button('start','Новая игра')+button('record','Лучший результат');
  } else if (target==='confirm') {
   title='Начать заново?';copy='Текущая партия завершится.';
   actions=button('fresh','Начать новую игру',true)+button('cancel','Вернуться');
  } else if (target==='over') {
   title='Ходов больше нет';copy='Твой результат · '+format(round.score);
   actions=button('fresh','Restart · Ещё раз',true)+button('record','Лучший результат');
  } else {
   title='Лучший результат';copy='Рекорд на этом устройстве';
   actions=button('cancel','Назад',true);
  }
  layer.innerHTML=`<section class="bl-panel bl-stage-enter" role="dialog" aria-modal="true" aria-labelledby="bl-title">
   <div class="bl-emblem" aria-hidden="true"></div><h2 id="bl-title">${title}</h2>
   ${target==='over'&&newRecord?'<div class="bl-victory">✦ Новый рекорд ✦</div>':''}
   <p>${copy}</p>${['menu','record','over'].includes(target)?'<div class="bl-record"><small>Личный рекорд</small>'+format(best)+'</div>':''}
   ${actions}${['pause','menu','over'].includes(target)&&exit?button('exit','Вернуться в «Разное»'):target==='pause'||target==='over'?button('home','Главное меню'):''}
  </section>`;
  const logo=get('.bl-emblem');
  for (const piece of [{id:13,color:2},{id:20,color:4},{id:9,color:3}]) logo.append(miniature(piece));
  if (target==='over'&&newRecord) animate(logo,[{transform:'scale(.8)'},{transform:'scale(1.15)'},{transform:'scale(1)'}],580);
  layer.querySelector('button').focus({preventScroll:true});
 }
 function transient(node,keys,duration) {
  if (reduced.matches) return;
  fx.append(node);
  node.animate(keys,{duration,easing:'ease-out'}).finished.then(()=>node.remove(),()=>node.remove());
 }
 function effects(move) {
  fx.replaceChildren();
  for (const index of move.placed) {
   const tile=cells[index].firstChild;
   if (tile) animate(tile,[{transform:'scale(.75)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],190);
  }
  if (move.refill) slots.forEach(slot=>animate(slot,[{transform:'translateY(8px)',opacity:.2},{transform:'none',opacity:1}],220));
  if (!move.lines) return;
  const rect=fx.getBoundingClientRect();
  for (const {index,color} of move.removed) {
   const cell=cells[index].getBoundingClientRect(), x=cell.left-rect.left,y=cell.top-rect.top;
   const glow=document.createElement('i');glow.className='bl-flash';
   Object.assign(glow.style,{left:x+'px',top:y+'px',width:cell.width+'px',height:cell.height+'px'});
   transient(glow,[{transform:'scale(1)',opacity:1},{transform:'scale(.5)',opacity:0}],320);
   for (let i=0;i<2;i++) {
    const part=document.createElement('i');part.className='bl-shard bl-c'+color;
    part.style.left=x+cell.width/2+'px';part.style.top=y+cell.height/2+'px';
    transient(part,[{opacity:1},{transform:`translate(${(Math.random()-.5)*90}px,${(Math.random()-.55)*90}px) rotate(100deg)`,opacity:0}],450);
   }
  }
  const label=move.perfect?'PERFECT':move.lines>=2?'AMAZING':round.combo>1?'COMBO':'GREAT';
  const message=document.createElement('strong');message.className='bl-callout';message.textContent=label+(round.combo>1?' ×'+round.combo:'');
  if (reduced.matches) {fx.append(message);setTimeout(()=>message.remove(),800);}
  else transient(message,[{transform:'scale(.8)',opacity:.1},{transform:'scale(1.06)',opacity:1,offset:.25},{transform:'translateY(-12px)',opacity:0}],820);
  if (round.combo>=3) animate(get('.bl-field'),[{transform:'translateX(-3px)'},{transform:'translateX(3px)'},{transform:'none'}],170);
 }
 function commit(slot,x,y) {
  if (screen!=='play') return;
  const move=place(round,slot,x,y);
  if (!move) {get('[data-bl-status]').textContent='Фигура сюда не помещается';return;}
  round=move.next;best=Math.max(best,round.score);selected=null;persist();paint(true);effects(move);
  tone(!move.lines?'place':round.combo>1||move.lines>1?'combo':'line');
  get('[data-bl-status]').textContent='Счёт '+format(round.score)+(move.lines?', очищено линий: '+move.lines:'');
  if (isOver(round)) menu('over');
 }
 function start() {
  previousBest=best;round=newRound();selected=null;fx.replaceChildren();persist();paint();menu('play');
 }
 function select(slot) {
  if (!round.hand[slot]) return;
  selected=selected===slot?null:slot;
  slots.forEach((el,i)=>el.setAttribute('aria-pressed',String(i===selected)));
  clearHint();if (selected!==null) hint(selected,cursor.x,cursor.y);
 }
 root.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if (button?.hasAttribute('data-slot')) {
   if (!suppressClick&&screen==='play') {
    select(Number(button.dataset.slot));
    if (selected!==null && event.detail===0) board.focus({preventScroll:true});
   }
   return;
  }
  const action=button?.dataset.bl;
  if (action==='audio') {sound=!sound;persist();paint();if(sound)tone('place');}
  else if (action==='exit') exit?.();
  else if (action==='home') menu('menu');
  else if (action==='back') {if(exit)exit();else menu('menu');}
  else if (action==='pause') menu('pause');
  else if (action==='resume') menu('play');
  else if (action==='record') {returnTo=screen;menu('record');}
  else if (action==='cancel') menu(returnTo);
  else if (action==='start' && round && !isOver(round)) {returnTo=screen;menu('confirm');}
  else if (action==='fresh'||action==='start') start();
  else if (selected!==null && screen==='play' && board.contains(event.target)) {
   const rect=board.getBoundingClientRect();
   commit(selected,Math.floor((event.clientX-rect.left)*SIDE/rect.width),Math.floor((event.clientY-rect.top)*SIDE/rect.height));
  }
 },{signal:lifetime.signal});
 function positionDrag() {
  frame=0;if(!drag?.moving)return;
  const {slot,px,py,touch}=drag, shape=shapes[round.hand[slot].id];
  const rect=board.getBoundingClientRect(), step=rect.width/SIDE;
  const left=px-step*shape.w/2, top=touch?py-step*shape.h-14:py-step*shape.h/2;
  drag.x=Math.round((left-rect.left)/step);drag.y=Math.round((top-rect.top)/step);
  drag.ghost.style.transform=`translate3d(${left}px,${top}px,0)`;
  drag.ghost.classList.toggle('bl-bad',!hint(slot,drag.x,drag.y));
 }
 tray.addEventListener('pointerdown',event=>{
  const button=event.target.closest('[data-slot]');
  if (!button||button.disabled||drag||screen!=='play'||event.button!==0)return;
  drag={id:event.pointerId,button,slot:Number(button.dataset.slot),startX:event.clientX,startY:event.clientY,touch:event.pointerType==='touch'};
  button.setPointerCapture(event.pointerId);
 },{signal:lifetime.signal});
 tray.addEventListener('pointermove',event=>{
  if (!drag||event.pointerId!==drag.id)return;
  drag.px=event.clientX;drag.py=event.clientY;
  if (!drag.moving) {
   if (Math.hypot(drag.px-drag.startX,drag.py-drag.startY)<4)return;
   drag.moving=true;selected=null;slots.forEach(slot=>slot.setAttribute('aria-pressed','false'));
   drag.ghost=miniature(round.hand[drag.slot]);drag.ghost.classList.add('bl-ghost');
   drag.ghost.style.setProperty('--unit',(board.getBoundingClientRect().width/SIDE-1)+'px');
   root.append(drag.ghost);
  }
  if (!frame)frame=requestAnimationFrame(positionDrag);
 },{signal:lifetime.signal});
 tray.addEventListener('pointerup',event=>{
  if (!drag||drag.id!==event.pointerId)return;
  if (!drag.moving){cancelDrag();return;}
  drag.px=event.clientX;drag.py=event.clientY;cancelAnimationFrame(frame);positionDrag();
  const {slot,x,y}=drag;cancelDrag();
  suppressClick=true;setTimeout(()=>suppressClick=false,0);commit(slot,x,y);
 },{signal:lifetime.signal});
 for(const name of ['pointercancel','lostpointercapture'])tray.addEventListener(name,event=>{
  if(event.pointerId===drag?.id)cancelDrag();
 },{signal:lifetime.signal});
 root.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
   if(screen==='play')menu('pause');else if(screen==='pause')menu('play');else if(screen==='record'||screen==='confirm')menu(returnTo);
   return;
  }
  if(screen!=='play'||event.target!==board||selected===null)return;
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(delta){event.preventDefault();cursor={x:Math.max(0,Math.min(7,cursor.x+delta[0])),y:Math.max(0,Math.min(7,cursor.y+delta[1]))};hint(selected,cursor.x,cursor.y);}
  else if(event.key==='Enter'||event.key===' '){event.preventDefault();commit(selected,cursor.x,cursor.y);}
 },{signal:lifetime.signal});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&screen==='play')menu('pause');},{signal:lifetime.signal});
 paint();menu('menu');
 return ()=>{lifetime.abort();cancelDrag();cancelAnimationFrame(scoreFrame);audio?.close().catch(()=>{});};
}
