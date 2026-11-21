const rules=[
  ['Только с 18 лет','Подтверди совершеннолетие, чтобы открыть ленту.'],
  ['Пиши со своей анкеты','Смотреть анкеты можно сразу. Для приглашений нужна своя опубликованная анкета.'],
  ['Telegram видит получатель','Когда ты отправляешь приглашение, человек сразу увидит твой ник. В общей ленте его нет.'],
  ['До 20 знакомств в день','Лимит действует до полуночи по Москве. Листать анкеты можно без ограничений.'],
  ['Свои фотографии','Используй своё фото. Убери телефоны, почту, ссылки, ники и QR-коды из описания и со снимка.'],
  ['Уважение к другим','Группу, курс и общежитие можно указать по желанию. Реклама, угрозы, оскорбления и откровенные материалы запрещены.'],
  ['Проверка и жалобы','Текст и фото проходят автоматическую проверку. В каждой анкете можно пожаловаться или заблокировать человека.'],
];

async function prepareImage(file){
  if(!file||!file.size)return null;
  if(file.size>20_000_000)throw Error('Выбери фотографию размером до 20 МБ.');
  const url=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('Не удалось прочитать фотографию.'));reader.readAsDataURL(file);
  });
  const img=new Image();img.src=url;
  try{await img.decode()}catch{throw Error('Выбери файл JPG, PNG или WebP.')}
  if(Math.min(img.naturalWidth,img.naturalHeight)<120)throw Error('Каждая сторона фотографии должна быть не меньше 120 пикселей.');
  const scale=Math.min(1,960/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  let output=canvas.toDataURL('image/jpeg',0.84);
  if(output.length>800000)output=canvas.toDataURL('image/jpeg',0.67);
  if(output.length>800000)throw Error('Выбери фотографию меньшего размера.');
  return output;
}

export function bindDating(root,{admin,initialTab='feed',api,esc,uiIcon,toast}){
  let data,tab=initialTab,editing=false,showRules=false,busy=false;
  let upload=null,fileTask=null,fileError='',revision=0;
  const call=(action,body)=>api('dating/'+action,body);
  const button=(label,action,kind='',id='')=>`<button type="button" data-daction="${action}"${id?' data-did="'+esc(id)+'"':''} class="${kind}">${label}</button>`;
  const heart=uiIcon('heart');
  function blank(title,body,action=''){
    return `<div class="dating-blank"><span class="dating-mark" aria-hidden="true">${heart}</span><h2>${title}</h2><p>${body}</p>${action}</div>`;
  }
  function rulesView(first){
    return `<section class="dating-rules card"><h2>Правила знакомств</h2><ul>${rules.map(([title,text])=>`<li><strong>${title}</strong><span>${text}</span></li>`).join('')}</ul>
      <p>Анкету могут сохранить скриншотом. Публикуй только то, чем готов поделиться с другими студентами.</p>
      ${first?`<form data-dform="accept"><label class="dating-agree"><input type="checkbox" name="adult" required>Мне есть 18 лет, я принимаю правила</label><button class="primary" disabled>Продолжить</button></form>`:button('Вернуться','rules-close')}</section>`;
  }
  function cardInfo(p){
    return `<h2>${esc(p.alias)}, ${esc(p.age)}</h2><div class="dating-tags"><span>${esc(p.purpose)}</span>${p.interests?p.interests.split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span>${esc(s)}</span>`).join(''):''}</div><p class="dating-about">${esc(p.about)}</p>`;
  }
  function safety(p){
    return `<details class="dating-safety"><summary>Действия с анкетой</summary><div class="dating-actions">${button('Пожаловаться','report','',p.id)}${button('Заблокировать','block','',p.id)}</div></details>`;
  }
  function feed(){
    const p=data.card;
    if(!p){
      const actions=(data.skipped?button('Вернуть пропущенные','reset-skips'):'')+(!data.own?button('Создать анкету','edit','primary'):'');
      return blank('Анкет пока нет','Здесь появятся новые анкеты студентов МГСУ.',actions);
    }
    const invite=data.canInvite?`<button type="button" data-daction="invite" data-did="${esc(p.id)}" class="primary" ${data.remaining?'':'disabled'}>Познакомиться</button>`:button(data.own?'Моя анкета':'Создать анкету',data.own?'own':'edit','primary');
    return `<article class="dating-card"><img class="dating-photo" src="${esc(p.photo)}" alt="Фото из анкеты"><div class="dating-card-body">${cardInfo(p)}
        <div class="dating-actions">${button('Пропустить','skip','',p.id)}${invite}</div>
        <p class="dating-hint">${data.canInvite?'Приглашений сегодня осталось '+data.remaining+' из '+data.limit+'.':'Приглашения доступны с опубликованной анкетой.'}</p>${safety(p)}</div></article>`;
  }
  function inbox(){
    if(!data.canInvite)return blank('Приглашения пока закрыты','Чтобы получать приглашения, опубликуй свою анкету и включи видимость.',button(data.own?'Моя анкета':'Создать анкету',data.own?'own':'edit','primary'));
    if(!data.inbox.length)return blank('Приглашений пока нет','Когда кто-то захочет познакомиться, здесь появятся его анкета и Telegram.');
    return data.inbox.map(p=>`<article class="dating-card dating-invite"><img src="${esc(p.photo)}" alt="Фото отправителя"><div class="dating-card-body">${cardInfo(p)}
      <div class="dating-actions"><a class="dating-contact" href="https://t.me/${esc(p.telegram)}" target="_blank" rel="noopener noreferrer">@${esc(p.telegram)} ↗</a>${button('Скрыть приглашение','dismiss','',p.id)}</div>${safety(p)}</div></article>`).join('');
  }
  function editor(){
    const p=data.own||{};
    return `<form class="card dating-form" data-dform="profile"><h2>${data.own?'Редактирование анкеты':'Создание анкеты'}</h2>
      <div class="dating-pair"><label>Имя или псевдоним<input name="alias" required maxlength="42" autocomplete="off" value="${esc(p.alias)}"></label>
      <label>Возраст<input name="age" type="number" min="18" max="120" inputmode="numeric" required value="${esc(p.age)}"></label></div>
      <label>Цель знакомства<select name="purpose">${['Дружба','Компания','Отношения'].map(v=>`<option${v===p.purpose?' selected':''}>${v}</option>`).join('')}</select></label>
      <label>Интересы<input name="interests" maxlength="100" placeholder="Например, волейбол, музыка" value="${esc(p.interests)}"></label>
      <label>О себе<textarea name="about" required maxlength="550" rows="4" placeholder="Что тебе нравится и какую компанию ищешь?">${esc(p.about)}</textarea></label>
      <label>Твой ник в Telegram<input name="telegram" required maxlength="33" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@username" value="${p.telegram?'@'+esc(p.telegram):''}"><small>Откроется человеку, которому ты отправишь приглашение.</small></label>
      <label>${p.canReuse?'Заменить фото':'Твоя фотография'}<input name="image" type="file" accept="image/jpeg,image/png,image/webp" ${p.canReuse?'':'required'}><small>JPG, PNG или WebP. Для конкурсной проверки используй вымышленное изображение.</small></label>
      <img class="dating-preview" alt="Предпросмотр фотографии" ${p.photo?'src="'+esc(p.photo)+'"':'hidden'}>
      <p class="error" role="alert"></p><div class="dating-actions">${button('Отмена','cancel-edit')}<button class="primary">Отправить на проверку</button></div></form>`;
  }
  function own(){
    const p=data.own;
    if(editing)return editor();
    if(!p)return blank('Твоя анкета','Выбери имя, добавь фото и расскажи, с кем хочешь познакомиться.',button('Создать анкету','edit','primary'));
    const statuses={pending:'На автоматической проверке',review:'На рассмотрении',rejected:'Нужны изменения',approved:p.visible?'Опубликована':'Скрыта из ленты'};
    return `<article class="card dating-own"><p class="dating-status" role="status">${statuses[p.state]}</p>
      ${p.reason?`<p><strong>${esc(p.field)}</strong> · ${esc(p.reason)}</p>`:''}
      ${p.live&&p.state!=='approved'&&p.visible?'<p>В ленте пока видна предыдущая одобренная версия.</p>':''}
      ${!p.visible&&p.state!=='approved'?'<p>Видимость анкеты выключена.</p>':''}
      ${p.photo?`<img class="dating-preview" src="${esc(p.photo)}" alt="Твоя фотография">`:''}
      ${cardInfo(p)}<p class="dating-hint">Твой Telegram · @${esc(p.telegram)}</p><div class="dating-actions">
      ${button('Редактировать','edit','primary')}${button(p.visible?'Скрыть анкету':'Показывать в ленте','visibility')}
      ${p.state==='rejected'&&p.hasPhoto&&!p.appeal?button('Оспорить решение','appeal'):''}
      ${button('Удалить анкету','delete','dating-danger')}</div>${p.appeal==='open'?'<p>Запрос на пересмотр отправлен.</p>':p.appeal==='closed'&&p.state==='rejected'?'<p>Пересмотр завершён. Можно отправить исправленную анкету.</p>':''}</article>`;
  }
  function moderation(){
    if(!data.length)return blank('Очередь пуста','Здесь появятся жалобы, запросы на пересмотр и фотографии, по которым автоматическая проверка не приняла решение.',button('Обновить','refresh'));
    const labels={report:'Жалоба',appeal:'Пересмотр',review:'Спорная анкета'};
    return data.map(c=>`<article class="card dating-case"><p class="dating-status">${labels[c.kind]}</p>${c.photo?`<img class="dating-preview" src="${esc(c.photo)}" alt="Фото из обращения">`:''}${cardInfo(c)}
      <p><strong>Основание</strong> · ${esc(c.detail)}</p>${c.reason&&c.detail!==c.reason?`<p>Решение проверки · ${esc(c.reason)}</p>`:''}
      <div class="dating-actions">${button(c.kind==='report'?'Оставить публикацию':'Одобрить','approve','primary',c.id)}${button(c.kind==='report'?'Снять с публикации':'Отклонить','reject','',c.id)}</div></article>`).join('');
  }
  function paint(){
    if(!root.isConnected)return;
    let content,title=admin?'Модерация знакомств':'Знакомства';
    if(admin)content=moderation();
    else if(!data.accepted||showRules)content=rulesView(!data.accepted);
    else{
      const tabs=[['feed','Анкеты'],['inbox','Приглашения'+(data.inbox.length?' · '+data.inbox.length:'')],['own','Моя анкета']];
      content=`<nav class="dating-tabs" aria-label="Разделы знакомств">${tabs.map(([id,label])=>`<button type="button" data-dtab="${id}" aria-pressed="${tab===id}">${label}</button>`).join('')}</nav>`;
      content+=tab==='feed'?feed():tab==='inbox'?inbox():own();
      if(tab==='own'&&!editing&&data.blocked.length)content+=`<details class="dating-safety card"><summary>Заблокированные · ${data.blocked.length}</summary>${data.blocked.map(b=>`<div class="dating-blocked"><span>${esc(b.label||'Удалённая анкета')}</span>${button('Разблокировать','unblock','',b.id)}</div>`).join('')}</details>`;
    }
    root.innerHTML=`<div class="dating-wrap"><div class="dating-heading"><h1>${title}</h1>${!admin&&data.accepted&&!showRules?button('Правила','rules','link-button'):''}</div>${content}</div>`;
  }
  async function refresh(quiet=false){
    const id=++revision;
    try{
      const update=await call(admin?'cases':'state');
      if(!root.isConnected||id!==revision)return;
      if(quiet&&(editing||busy||root.querySelector('dialog[open]')||showRules))return;
      if(!quiet||JSON.stringify(update)!==JSON.stringify(data)){data=update;paint()}
    }catch(error){
      if(!root.isConnected||id!==revision||quiet)return;
      root.innerHTML=`<div class="dating-wrap"><h1>Знакомства</h1><p role="alert">${esc(error.message)}</p>${button('Повторить','refresh')}</div>`;
    }
  }
  function dialog(title,content,submit,label='Подтвердить'){
    const d=document.createElement('dialog');d.className='dating-dialog';
    d.innerHTML=`<h2>${title}</h2><form>${content}<p class="error" role="alert"></p><div class="dating-actions"><button type="button" data-dcancel>Отмена</button><button class="primary">${label}</button></div></form>`;
    root.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();
    d.querySelector('[data-dcancel]').onclick=()=>d.close();
    d.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      const form=event.currentTarget,ok=form.querySelector('.primary');ok.disabled=true;busy=true;
      try{
        await submit(Object.fromEntries(new FormData(form)));
        d.close();await refresh();
      }catch(error){form.querySelector('.error').textContent=error.message}
      finally{ok.disabled=false;busy=false}
    };
  }
  const reasonField=label=>`<label>${label}<textarea name="detail" rows="3" required maxlength="350"></textarea></label>`;
  root.addEventListener('click',async event=>{
    const control=event.target.closest('[data-daction],[data-dtab]');
    if(!control||busy)return;
    const id=control.dataset.did,action=control.dataset.daction;
    if(control.dataset.dtab){tab=control.dataset.dtab;editing=false;upload=null;fileTask=null;paint();return}
    if(action==='rules'||action==='rules-close'){showRules=action==='rules';editing=false;paint();return}
    if(action==='own'||action==='edit'||action==='cancel-edit'){tab='own';editing=action==='edit';upload=null;fileTask=null;fileError='';paint();return}
    if(action==='refresh'){await refresh();return}
    if(action==='invite'){
      const handle=data.own?.liveTelegram;
      const edition=data.card.edition,senderEdition=data.own.liveEdition;
      dialog('Отправить приглашение?',`<p>Получатель сразу увидит твой Telegram${handle?' <strong>@'+esc(handle)+'</strong>':''} и сможет написать тебе.</p>`,async()=>{await call('invite',{profile:id,edition,senderEdition});toast('Приглашение отправлено')},'Отправить');return;
    }
    if(action==='report'||action==='appeal'){
      const edition=(tab==='inbox'?data.inbox.find(p=>p.id===id):data.card)?.edition;
      dialog(action==='report'?'Пожаловаться на анкету':'Пересмотр анкеты',reasonField(action==='report'?'Что нарушает правила?':'Что следует перепроверить?'),async values=>{await call(action,{profile:id,edition,...values});toast('Обращение отправлено')},'Отправить');return;
    }
    if(action==='block'||action==='delete'){
      dialog(action==='block'?'Заблокировать человека?':'Удалить анкету?',action==='block'?'<p>Вы перестанете видеть анкеты и приглашения друг друга.</p>':'<p>Фотография, текст и приглашения будут удалены. Позже можно создать новую анкету.</p>',async()=>{await call(action,id?{profile:id}:{});toast(action==='delete'?'Анкета удалена':'Пользователь заблокирован')},action==='block'?'Заблокировать':'Удалить');return;
    }
    if(action==='reject'){
      dialog('Причина решения',reasonField('Что требуется исправить?'),v=>call('decide',{id:Number(id),decision:'reject',reason:v.detail}),'Подтвердить');return;
    }
    busy=true;control.disabled=true;
    try{
      if(action==='approve')await call('decide',{id:Number(id),decision:'approve'});
      else if(action==='unblock')await call(action,{id:Number(id)});
      else if(action==='visibility')await call(action,{visible:!data.own.visible});
      else await call(action,id?{profile:id}:{});
      await refresh();
    }catch(error){toast(error.message)}finally{busy=false;control.disabled=false}
  });
  root.addEventListener('change',event=>{
    const input=event.target,form=input.form;
    if(form?.dataset.dform==='accept'){form.querySelector('.primary').disabled=!input.checked;return}
    if(input.name!=='image'||!form)return;
    const marker=++revision;upload=null;fileError='';const preview=form.querySelector('.dating-preview');
    const restorePreview=()=>{if(data.own?.photo){preview.src=data.own.photo;preview.hidden=false}else{preview.removeAttribute('src');preview.hidden=true}};
    if(!input.files.length){fileTask=null;restorePreview();return}
    form.querySelector('.error').textContent='';
    fileTask=prepareImage(input.files[0]).then(url=>{
      if(!form.isConnected||marker!==revision)return;
      upload=url.split(',')[1];preview.src=url;preview.hidden=false;
    }).catch(error=>{
      if(!form.isConnected||marker!==revision)return;
      fileError=error.message;restorePreview();form.querySelector('.error').textContent=fileError;
    });
  });
  root.addEventListener('submit',async event=>{
    const form=event.target,type=form.dataset.dform;
    if(!type)return;
    event.preventDefault();if(busy)return;
    busy=true;const submit=form.querySelector('.primary');submit.disabled=true;
    try{
      if(type==='accept')await call('accept',{adult:form.elements.adult.checked,rules:1});
      else{
        if(fileTask)await fileTask;
        if(fileError)throw Error(fileError);
        if(!upload&&!data.own?.canReuse)throw Error('Выбери фотографию для анкеты.');
        const values=Object.fromEntries(new FormData(form));delete values.image;
        await call('profile',{...values,age:Number(values.age),previous:data.own?.id??null,...(upload?{image:upload}:{})});
        editing=false;upload=null;fileTask=null;tab='own';toast('Анкета отправлена на проверку');
      }
      await refresh();
    }catch(error){const box=form.querySelector('.error');if(box)box.textContent=error.message;else toast(error.message)}
    finally{busy=false;submit.disabled=false}
  });
  refresh();
  const timer=setInterval(()=>{
    if(!root.isConnected){clearInterval(timer);return}
    if(document.hidden||busy||editing||showRules||!data||!admin&&!data.accepted||root.querySelector('dialog[open],details[open]'))return;
    refresh(true);
  },7000);
}
