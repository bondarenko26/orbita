const campusAddress = 'Москва, Ярославское шоссе, д. 26';
const sportsAddress = 'Москва, Ярославское шоссе, д. 26, к. 11';

// Points and labels use the drawing's own coordinate system, not geographic coordinates.
const places = {
  kmk: {
    code: 'КМК', name: 'Корпус младших курсов',
    summary: 'Лекционные и практические аудитории в длинном центральном корпусе.',
    detail: 'Тянется от библиотеки и ректората к УЛК. Вдоль корпуса расположены холлы № 1 и № 2.',
    point: [208, 218], label: [125, 222],
  },
  kpa: {
    code: 'КПА', name: 'Корпус поточных аудиторий',
    summary: '«Ромашка» — круглое здание с лекционными залами вокруг центра.',
    detail: 'У конца КМК, со стороны столовой. Его легко узнать по аудиториям в форме лепестков.',
    point: [94, 325], label: [67, 388],
  },
  sok: {
    code: 'СОК', name: 'Спортивно-оздоровительный комплекс',
    summary: 'Спортивные залы и занятия физической культурой.',
    detail: 'Дворец спорта находится за пределами схемы учебных корпусов.',
  },
  admin: {
    code: 'Свечка', name: 'Административный корпус',
    summary: 'Высотный корпус, где находится ректорат.',
    detail: 'Башня у начала КМК. Рядом на схеме расположены библиотека и актовый зал.',
    point: [191, 88], label: [95, 76],
  },
  ulk: {
    code: 'УЛК', name: 'Учебно-лабораторный корпус',
    summary: 'Квадратный корпус с остеклённой пирамидой на крыше.',
    detail: 'Расположен сбоку от КМК, напротив корпуса поточных аудиторий.',
    point: [266, 309], label: [350, 315],
  },
  ulb: {
    code: 'УЛБ', name: 'Учебно-лабораторный блок',
    summary: 'Три корпуса, обозначенные в расписании буквами А, Б и Г.',
    detail: 'В записи «203 Б / УЛБ» число означает аудиторию, а буква Б — корпус. Выберите нужную букву на схеме.',
    point: [379, 179],
  },
  library: {
    code: 'НТБ', name: 'Научно-техническая библиотека',
    summary: 'Библиотека у начала корпуса младших курсов.',
    detail: 'Ищите невысокое здание рядом с башней ректората, у торца длинного КМК.',
    point: [298, 104], label: [320, 53],
  },
  canteen: {
    code: 'Столовая', name: 'Столовая',
    detail: 'На схеме столовая находится в конце перехода от КМК, рядом с «Ромашкой».',
    point: [180, 388], label: [310, 406],
  },
  a: {
    code: 'УЛБ А', name: 'Корпус А', parent: 'ulb',
    detail: 'Часть учебно-лабораторного блока между КМК и корпусом Г.',
    point: [314, 187], label: [315, 236],
  },
  b: {
    code: 'УЛБ Б', name: 'Корпус Б', parent: 'ulb',
    detail: 'Крыло учебно-лабораторного блока справа от корпуса Г на схеме.',
    point: [433, 198], label: [449, 250],
  },
  g: {
    code: 'УЛБ Г', name: 'Корпус Г', parent: 'ulb',
    detail: 'Поперечный корпус учебно-лабораторного блока между крыльями А и Б.',
    point: [386, 153], label: [433, 96],
  },
};

const guideIds = ['kmk', 'kpa', 'sok', 'admin', 'ulk', 'ulb', 'library'];
const planWidth = 500, planHeight = 444;
const zoomLevels = [1, 1.5, 2, 3];

// A common oblique projection keeps the buildings and their connecting galleries aligned.
function project([x, y], height = 0) {
  return [174 + x - 0.30 * y, 118 + 0.13 * x + 0.84 * y - height];
}
function coordinates(points) {
  return points.map(([x,y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
}
function polygon(kind, points) {
  return `<polygon class="${kind}" points="${coordinates(points)}"/>`;
}
function line(kind, points) {
  return `<polyline class="${kind}" points="${coordinates(points)}"/>`;
}
function rectangle(x,y,width,depth) {
  return [[x,y],[x+width,y],[x+width,y+depth],[x,y+depth]];
}
function solid(footprint, top, base = 0, floors = 0) {
  const roof = footprint.map(p => project(p,top));
  const bottom = footprint.map(p => project(p,base));
  let walls = '';
  for (let i = 0; i < roof.length; i++) {
    const j = (i + 1) % roof.length;
    if (roof[j][0] >= roof[i][0]) continue;
    const side = Math.abs(roof[j][1]-roof[i][1]) > roof[i][0]-roof[j][0];
    walls += polygon(side?'plan-wall side':'plan-wall', [roof[i],roof[j],bottom[j],bottom[i]]);
    for (let floor = 1; floor < floors; floor++) {
      const level = base + (top-base)*floor/floors;
      walls += line('plan-window', [project(footprint[i],level),project(footprint[j],level)]);
    }
  }
  return walls + polygon('plan-roof', roof);
}
function block(x,y,width,depth,top,base = 0,floors = 0) {
  return solid(rectangle(x,y,width,depth),top,base,floors);
}
function roofPanel(x,y,width,depth,height) {
  return polygon('plan-glass', rectangle(x,y,width,depth).map(p => project(p,height)));
}
function roundPoint(x,y,radius,angle) {
  return [x + Math.cos(angle)*radius, y + Math.sin(angle)*radius];
}
function circularFootprint(x,y,radius) {
  return Array.from({length:24}, (_,i) => roundPoint(x,y,radius,i*Math.PI/12));
}
function lectureHall() {
  const cx = -3, cy = 256, petals = [];
  for (let i = 0; i < 10; i++) {
    const a = i*Math.PI/5, b = a + Math.PI/5;
    const footprint = [[24,a+0.03],[48,a+0.035],[51,(a+b)/2],[48,b-0.035],[24,b-0.03]]
      .map(([r,theta]) => roundPoint(cx,cy,r,theta));
    petals.push({depth:project(footprint[2])[1],drawing:solid(footprint,13,0,2)});
  }
  return petals.sort((a,b) => a.depth-b.depth).map(p => p.drawing).join('') +
    solid(circularFootprint(cx,cy,23),18,0,2) + solid(circularFootprint(cx,cy,10),23,18);
}
function labRoof() {
  const rim = rectangle(137,221,34,29).map(p => project(p,22));
  const apex = project([154,235.5],34);
  return block(119,202,75,67,18,0,3) + block(126,208,61,52,22,18) +
    rim.map((p,i) => polygon('plan-glass', [p,rim[(i+1)%4],apex])).join('');
}
function building(id, drawing) {
  const place = places[id];
  return `<g class="plan-building" data-map-place="${id}" tabindex="0" role="button"
    aria-label="${place.code === place.name ? place.name : place.code+' — '+place.name}" aria-pressed="false">
    <title>${place.name}</title>${drawing}</g>`;
}
function callout(id) {
  const {code,point,label:[x,y]} = places[id];
  const width = Math.max(54,code.length*11+20);
  const hitWidth = Math.max(74,width+8);
  return `<g class="plan-callout" data-map-place="${id}" aria-hidden="true">
    ${line('plan-leader',[point,[x,y]])}<circle class="plan-dot" cx="${point[0]}" cy="${point[1]}" r="2.5"/>
    <rect class="plan-hit" x="${x-hitWidth/2}" y="${y-36}" width="${hitWidth}" height="72"/>
    <rect class="plan-chip" x="${x-width/2}" y="${y-15}" width="${width}" height="30" rx="8"/>
    <text x="${x}" y="${y}" dy=".35em" text-anchor="middle">${code}</text></g>`;
}
function campusDrawing() {
  const pad = polygon('plan-plinth', [
    [-17,-12],[60,-12],[60,-49],[168,-49],[168,12],[244,12],[244,39],[329,39],
    [329,94],[107,94],[107,197],[201,197],[201,276],[150,276],[150,355],
    [60,355],[60,275],[38,275],[38,242],[60,242],[60,31],[-17,31],
  ].map(p => project(p)));
  const galleries = block(64,210,23,81,6) + block(32,249,49,15,6) +
    block(83,210,41,16,7) + block(42,-6,56,25,6);
  const tower = block(-7,-6,54,31,72,0,12) + block(0,-3,40,23,77,72) +
    [1,9,17,25,33,41].map(x => line('plan-mullion',[project([x,25],70),project([x,25],2)])).join('');
  const spine = block(64,17,44,201,17,0,3) +
    [42,80,118,156,194].map(y => block(72,y,26,11,20,17)).join('');
  const wingsB = [[238,47],[321,47],[321,61],[283,61],[283,72],[322,72],[322,88],[238,88]];
  const scene = [
    building('library', block(65,-42,97,55,13,0,2) + roofPanel(84,-32,30,22,13) + roofPanel(131,-22,17,20,13)),
    '<g class="plan-context">'+solid(circularFootprint(48,-10,19),11,0,2)+'</g>',
    building('admin',tower),
    building('a',block(108,65,98,23,12,0,2) + roofPanel(127,69,35,11,12)),
    building('b',solid(wingsB,12,0,2)),
    building('g',block(205,-1,32,89,26,0,4) + roofPanel(211,14,18,35,26)),
    building('kmk',spine),
    building('ulk',labRoof()),
    building('kpa',lectureHall()),
    building('canteen',block(65,279,81,69,10,0,2) + block(72,288,55,48,14,10) + roofPanel(83,297,34,19,14)),
  ];
  const labels = Object.keys(places).filter(id => places[id].label).map(callout).join('');
  return `<svg class="campus-drawing" viewBox="0 0 ${planWidth} ${planHeight}" role="group" aria-label="Учебные корпуса МГСУ">
    <g aria-hidden="true" class="plan-context">${pad}${galleries}</g>${scene.join('')}${labels}</svg>`;
}

function mapDialog() {
  const options = [...guideIds, 'a','b','g','canteen'].map(id => {
    const {code,name} = places[id];
    return `<option value="${id}">${code === name ? name : code+' — '+name}</option>`;
  }).join('');
  return `<dialog class="campus-map-dialog" aria-labelledby="campus-map-title">
    <header class="campus-dialog-head"><div><h2 id="campus-map-title">Схема кампуса</h2>
    <p>${campusAddress}</p></div><button type="button" data-map-close aria-label="Закрыть схему" autofocus>×</button></header>
    <div class="campus-map-layout"><section class="campus-board" aria-label="Интерактивная схема">
    <div class="campus-viewport" tabindex="0" role="region" aria-label="Область схемы">${campusDrawing()}</div>
    <div class="campus-controls" role="group" aria-label="Масштаб схемы">
    <button type="button" data-zoom="out" aria-label="Уменьшить масштаб">−</button>
    <output aria-label="Текущий масштаб">100%</output><button type="button" data-zoom="in" aria-label="Увеличить масштаб">+</button>
    <button type="button" data-zoom="fit">Вся схема</button></div></section>
    <section class="campus-details"><label>Корпус или ориентир
    <select data-map-select><option value="">Все корпуса</option>${options}</select></label>
    <div data-map-details aria-live="polite"></div></section></div></dialog>`;
}

export function campusDirectory(pinIcon) {
  const rows = guideIds.map(id => {
    const {code,name,summary} = places[id];
    return `<li><button type="button" class="campus-row" data-open-map="${id}" aria-haspopup="dialog">
      <span class="campus-code">${code}</span><span class="campus-row-copy"><strong>${name}</strong>
      <span>${summary}</span></span><span class="campus-chevron" aria-hidden="true">›</span></button></li>`;
  }).join('');
  return `<section data-campus-guide><h1>Карта МГСУ</h1>
    <button type="button" class="campus-entry" data-open-map="" aria-haspopup="dialog">
    <span class="campus-pin">${pinIcon}</span><span class="campus-row-copy"><strong>Главный кампус НИУ МГСУ</strong>
    <span>${campusAddress}</span></span><span class="campus-entry-action">Карта ›</span></button>
    <h2 class="section-title">Корпуса и аббревиатуры из расписания</h2>
    <ul class="campus-list">${rows}</ul>${mapDialog()}</section>`;
}

function placeDetails(id) {
  if (!id) return '<p>Нажмите на корпус или выберите его в списке.</p>';
  const place = places[id];
  const address = id === 'sok' ? `<p>${sportsAddress}</p><a class="download" target="_blank" rel="noopener noreferrer"
    href="https://yandex.ru/maps/213/moscow/?text=${encodeURIComponent(sportsAddress)}">Открыть адрес на карте ↗</a>` : '';
  return `<h3>${place.name}</h3><p>${place.detail}</p>${address}`;
}

export function bindCampusDirectory(root) {
  const dialog = root.querySelector('dialog');
  const viewport = dialog.querySelector('.campus-viewport');
  const drawing = dialog.querySelector('.campus-drawing');
  const select = dialog.querySelector('[data-map-select]');
  const markers = [...drawing.querySelectorAll('[data-map-place]')];
  let zoom = 0, drag = null, dragged = false;

  function setZoom(step, point) {
    const center = point || [
      (viewport.scrollLeft+viewport.clientWidth/2)/drawing.clientWidth*planWidth,
      (viewport.scrollTop+viewport.clientHeight/2)/drawing.clientHeight*planHeight,
    ];
    zoom = Math.max(0,Math.min(step,zoomLevels.length-1));
    drawing.style.width = zoomLevels[zoom]*100+'%';
    viewport.dataset.zoomed = String(zoom>0);
    viewport.scrollLeft = center[0]/planWidth*drawing.clientWidth - viewport.clientWidth/2;
    viewport.scrollTop = center[1]/planHeight*drawing.clientHeight - viewport.clientHeight/2;
    dialog.querySelector('output').textContent = zoomLevels[zoom]*100+'%';
    dialog.querySelector('[data-zoom="out"]').disabled = zoom===0;
    dialog.querySelector('[data-zoom="in"]').disabled = zoom===zoomLevels.length-1;
  }
  function pick(id, center) {
    select.value = id;
    for (const marker of markers) {
      const key = marker.dataset.mapPlace;
      const active = key===id || places[key].parent===id;
      marker.classList.toggle('is-selected',active);
      if (marker.hasAttribute('role')) marker.setAttribute('aria-pressed',String(active));
    }
    dialog.querySelector('[data-map-details]').innerHTML = placeDetails(id);
    if (center) {
      const point = places[id]?.point;
      setZoom(point ? Math.max(zoom,1) : 0, point || [planWidth/2,planHeight/2]);
    }
  }
  root.addEventListener('click',event => {
    const open = event.target.closest('[data-open-map]');
    if (open) {
      dialog.showModal();
      dialog.scrollTop = 0;
      zoom = 0;
      drag = null;
      dragged = false;
      pick(open.dataset.openMap,true);
      return;
    }
    if (event.target.closest('[data-map-close]')) { dialog.close(); return; }
    const control = event.target.closest('[data-zoom]');
    if (control) {
      if (control.dataset.zoom==='fit') pick('',true);
      else setZoom(zoom+(control.dataset.zoom==='in'?1:-1));
      return;
    }
    const hit = event.target.closest('[data-map-place]');
    if (hit && !dragged) pick(hit.dataset.mapPlace,false);
  });
  select.addEventListener('change',() => pick(select.value,true));
  drawing.addEventListener('keydown',event => {
    if (!['Enter',' '].includes(event.key)) return;
    const hit = event.target.closest('[role="button"]');
    if (hit) { event.preventDefault(); pick(hit.dataset.mapPlace,false); }
  });
  // Touch and keyboard use native scrolling. Add drag-to-pan for a mouse at larger scales.
  viewport.addEventListener('pointerdown',event => {
    dragged = false;
    drag = event.pointerType==='mouse' && event.button===0 && zoom>0
      ? {id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop} : null;
  });
  viewport.addEventListener('pointermove',event => {
    if (!drag || drag.id!==event.pointerId || !event.buttons) return;
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    if (!dragged && Math.hypot(dx,dy)<5) return;
    dragged = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.scrollLeft = drag.left-dx;
    viewport.scrollTop = drag.top-dy;
  });
  viewport.addEventListener('pointerup',() => { drag=null; });
  viewport.addEventListener('pointercancel',() => { drag=null; });
}
