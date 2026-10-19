import { academicHours,normalize,groupEvents,isReady,googleExportUrl } from './core.js';
import {readWorkbook,readDocx,templateCategories,exampleDictionary,calendarDictionary,extractEvents,exportDocx} from './files.js';
const $=id=>document.getElementById(id);
const state={sheets:[],events:[],categories:[],dictionary:[],filter:'all',page:0,editing:null,template:null,calendar:null,example:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'';}
async function task(fn){try{await fn();}catch(e){message(e.message||'Не удалось обработать файл',true);console.error(e);}}
async function asset(name){const res=await fetch(`./assets/${name}.docx`);if(!res.ok)throw Error('Не удалось загрузить '+name);return res.arrayBuffer();}
let referenceReady=false,working=false;
async function initialize(){
  [state.template,state.calendar,state.example]=await Promise.all(['template','calendar','example'].map(asset));
  await rebuildDictionary();referenceReady=true;message('Шаблон и справочники загружены. Добавьте план-сетку для начала работы.');
}
async function rebuildDictionary(){
  const [template,calendar,example]=await Promise.all([state.template,state.calendar,state.example].map(readDocx));
  const categories=templateCategories(template.xml);
  const dictionary=[...exampleDictionary(example.xml),...calendarDictionary(calendar.xml,categories)];
  state.categories=categories;state.dictionary=dictionary;
}
function clearResult(){state.events=[];$('review').hidden=true;state.page=0;$('step2').classList.remove('active');$('step3').classList.remove('active');}
async function loadWorkbook(data,name){
  const sheets=await readWorkbook(data);state.sheets=sheets;clearResult();
  $('file-label').textContent=name;$('sheet').innerHTML=sheets.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join('');
  updatePrograms();$('selectors').hidden=false;message(`Файл прочитан. Доступно листов с план-сеткой: ${sheets.length}. Выберите программу.`);
}
function updatePrograms(){const s=state.sheets[+$('sheet').value];$('program').innerHTML=s.programs.map(p=>`<option value="${esc(p.col)}">${esc(p.title)}</option>`).join('');const business=s.programs.find(p=>p.title==='Бизнес-лагерь');if(business)$('program').value=business.col;}
$('sheet').onchange=()=>{clearResult();updatePrograms();};$('program').onchange=clearResult;
$('workbook').onchange=()=>task(async()=>{const f=$('workbook').files[0];if(f)await loadWorkbook(await f.arrayBuffer(),f.name);});
for(const type of ['dragenter','dragover'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.add('drag');});
for(const type of ['dragleave','drop'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.remove('drag');});
$('drop').addEventListener('drop',e=>task(async()=>{const f=e.dataTransfer.files[0];if(f)await loadWorkbook(await f.arrayBuffer(),f.name);}));
$('import-link').onclick=()=>task(async()=>{
  const url=googleExportUrl($('google-url').value.trim());$('google-download').href=url;$('google-download').hidden=false;
  $('import-link').disabled=true;message('Загружаю таблицу из Google…');
  try{const r=await fetch(url,{signal:AbortSignal.timeout(20000),credentials:'omit'});if(!r.ok)throw Error('Доступ к таблице закрыт');await loadWorkbook(await r.arrayBuffer(),'План-сетка из Google');}
  catch{throw Error('Google не разрешил загрузку. Откройте «Скачать XLSX из Google» и добавьте скачанный файл.');}
  finally{$('import-link').disabled=false;}
});
for(const kind of ['template','calendar','example'])$(kind).onchange=()=>task(async()=>{
  if(!referenceReady)throw Error('Дождитесь загрузки исходных справочников');
  const f=$(kind).files[0];if(!f)return;const previous=state[kind];
  state[kind]=await f.arrayBuffer();try{await rebuildDictionary();}catch(e){state[kind]=previous;throw e;}
  clearResult();$(kind+'-status').textContent=f.name;message('Справочник обновлён. Заново разберите план-сетку.');
});
$('analyze').onclick=()=>task(async()=>{
  if(!referenceReady)throw Error('Справочники ещё загружаются. Если загрузка завершилась ошибкой, обновите страницу.');
  const sheet=state.sheets[+$('sheet').value],col=$('program').value;
  state.events=extractEvents(sheet,col,state.dictionary,state.categories);state.filter='all';state.page=0;$('search').value='';
  if(!state.events.length)throw Error('В выбранном столбце нет мероприятий');
  $('review-title').textContent=sheet.programs.find(p=>p.col===col).title;$('review').hidden=false;$('step2').classList.add('active');
  message('Сетка разобрана. Проверьте записи с несколькими мероприятиями и неизвестными разделами.');render();$('review').scrollIntoView({behavior:'smooth',block:'start'});
});
function categoryName(id){return state.categories.find(c=>c.id===id)?.name||'Раздел не выбран';}
function options(value){return '<option value="">Выберите раздел или модуль</option>'+state.categories.map(c=>`<option value="${esc(c.id)}" ${c.id===value?'selected':''}>${esc(c.id==='leisure'?c.name:c.id+' · '+c.name)}</option>`).join('');}
function pending(){return state.events.filter(e=>!isReady(e));}
function render(){
  const included=state.events.filter(e=>!e.excluded),groups=groupEvents(included);
  $('stat-events').textContent=new Set(included.map(e=>normalize(e.title))).size;
  $('stat-hours').textContent=groupEvents(included.filter(isReady)).reduce((s,g)=>s+g.hours,0);
  $('stat-review').textContent=pending().length;$('stat-excluded').textContent=state.events.length-included.length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===state.filter));
  $('pagination').innerHTML='';
  if(state.filter==='summary'){
    $('event-list').innerHTML=state.categories.map(c=>{const items=groups.filter(g=>g.category===c.id);return `<div class="summary-row"><span>${esc(c.name)}<small style="display:block;color:#82929c">${items.length} мероприятий</small></span><b>${items.reduce((s,g)=>s+g.hours,0)} ч${items.some(g=>g.incomplete)?' · не все проверены':''}</b></div>`;}).join('');return;
  }
  const query=normalize($('search').value);
  const list=state.events.filter(e=>(state.filter==='all'||(state.filter==='pending'&&!isReady(e))||(state.filter==='excluded'&&e.excluded))&&normalize(e.title).includes(query));
  const pages=Math.max(1,Math.ceil(list.length/25));state.page=Math.min(state.page,pages-1);
  $('event-list').innerHTML=list.slice(state.page*25,(state.page+1)*25).map(e=>{
    const ready=isReady(e),h=academicHours(e.minutes),valid=h!==null&&e.confirmed;
    return `<div class="event ${e.excluded?'is-excluded':''}"><div><strong>${esc(e.title)}</strong><small>${esc(e.date)} · ${esc(e.cell)} · ${esc(e.excluded?e.exclusion||'Исключено пользователем':categoryName(e.category))}</small></div><div class="state"><span class="badge ${e.excluded?'excluded':ready?'':'pending'}">${e.excluded?'Исключено':ready?'Проверено':'Нужна проверка'}</span></div><div class="hours">${e.excluded?'—':valid?h*e.count:'?'}<small>акад. час</small></div><button data-edit="${e.id}">Изменить</button></div>`;
  }).join('')||'<div class="empty">Нет мероприятий по выбранному фильтру</div>';
  if(pages>1)$('pagination').innerHTML=`<button id="prev" ${state.page===0?'disabled':''}>← Назад</button><span>${state.page+1} / ${pages} · ${list.length} записей</span><button id="next" ${state.page===pages-1?'disabled':''}>Далее →</button>`;
  if($('prev'))$('prev').onclick=()=>{state.page--;render();};if($('next'))$('next').onclick=()=>{state.page++;render();};
  $('event-list').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(+b.dataset.edit));
}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;state.page=0;render();});$('search').oninput=()=>{state.page=0;render();};
$('reset').onclick=()=>{clearResult();message('Результат очищен. Исходные файлы сохранены до закрытия страницы.');};
function calculation(){const m=+$('edit-minutes').value,n=+$('edit-count').value,h=academicHours(m);$('edit-calculation').textContent=h&&n>0?`${m} мин → ${h} акад. ч × ${n} проведений = ${h*n} акад. ч`:'Введите длительность и количество';}
function edit(id){
  const e=state.events.find(e=>e.id===id);state.editing=id;
  $('edit-source').textContent=`${e.date} · ячейка ${e.cell} · интервалы сетки: ${e.slot||'не указаны'}`;
  $('edit-raw').textContent=e.raw;$('edit-title').value=e.title;$('edit-minutes').value=e.minutes??'';$('edit-count').value=e.count;
  $('edit-category').innerHTML=options(e.category);$('edit-excluded').checked=e.excluded;$('edit-apply').checked=false;
  $('edit-suggestion').textContent=[e.reason,e.suggestion?`Похожее: «${e.suggestion.title}» → ${categoryName(e.suggestion.category)}. Выберите раздел, если совпадение верно.`:e.match].filter(Boolean).join('. ');
  calculation();$('editor').showModal();
}
$('edit-minutes').oninput=calculation;$('edit-count').oninput=calculation;
$('edit-form').onsubmit=e=>e.preventDefault();$('edit-cancel').onclick=()=>$('editor').close();document.querySelector('#editor .close').onclick=e=>{e.preventDefault();$('editor').close();};
$('edit-save').onclick=()=>{
  const e=state.events.find(e=>e.id===state.editing),excluded=$('edit-excluded').checked;
  const minutes=+$('edit-minutes').value,count=+$('edit-count').value,title=$('edit-title').value.trim(),category=$('edit-category').value;
  if(!excluded&&(!title||!category||!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isInteger(count)||count<1||count>999)){
    $('edit-suggestion').textContent='Укажите название, раздел, длительность 1–1440 минут и число проведений 1–999.';return;
  }
  const key=normalize(e.title);Object.assign(e,{title:title||e.title,minutes:minutes||null,count,category,excluded,confirmed:!excluded,reason:'',exclusion:excluded?'Исключено пользователем':''});
  if($('edit-apply').checked&&category)for(const other of state.events)if(normalize(other.title)===key)other.category=category;
  $('editor').close();render();if($('resolve').open)renderResolve();
};
function renderResolve(){
  const list=pending();$('resolve-message').textContent=list.length?`Осталось уточнить ${list.length} записей. Выберите разделы, затем проверьте длительность там, где время неоднозначно.`:'Все мероприятия распределены, длительности проверены. Можно сохранить документ.';
  $('resolve-download').disabled=!!list.length||working;
  $('resolve-list').innerHTML=list.map(e=>`<div class="resolve-item"><strong>${esc(e.title)}</strong><small>${esc(e.date)} · ${esc(e.cell)}${!e.confirmed?' · требуется проверка времени':''}</small><div class="input-action"><select aria-label="Раздел для ${esc(e.title)}" data-category="${e.id}">${options(e.category)}</select><button class="secondary" data-fix="${e.id}">Проверить время</button></div></div>`).join('');
  $('resolve-list').querySelectorAll('[data-category]').forEach(s=>s.onchange=()=>{state.events.find(e=>e.id===+s.dataset.category).category=s.value;render();renderResolve();});
  $('resolve-list').querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>edit(+b.dataset.fix));
}
$('export').onclick=()=>{renderResolve();$('resolve').showModal();};$('resolve-close').onclick=$('resolve-back').onclick=()=>$('resolve').close();
$('resolve-download').onclick=()=>task(async()=>{
  if(pending().length)throw Error('Сначала проверьте все мероприятия');
  const groups=groupEvents(state.events.filter(e=>!e.excluded));if(!groups.length)throw Error('Нет мероприятий для документа');
  working=true;renderResolve();
  try{
    const blob=await exportDocx(state.template,groups,state.categories);
    const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=`Учебный план_${$('review-title').textContent.replace(/[\\/:*?"<>|]/g,'_')}.docx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('resolve').close();$('step3').classList.add('active');message('DOCX сформирован. Изменена таблица учебного плана; остальные разделы исходного шаблона сохранены.');
  }finally{working=false;renderResolve();}
});
task(initialize);
