import { academicHours,normalize,groupEvents,reviewGroups,isReady,googleExportUrl,applyEventEdit } from './core.js';
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
function reviewList(){return reviewGroups(state.events);}
function groupDescription(g){return `Занятий на ребёнка: ${g.count} · записей в сетке: ${g.occurrences.length}${g.unequal?' · нагрузка групп различается, учтён максимум':''}`;}
function render(){
  const included=state.events.filter(e=>!e.excluded),groups=groupEvents(included);
  $('stat-events').textContent=new Set(included.map(e=>normalize(e.title))).size;
  $('stat-hours').textContent=groupEvents(included.filter(isReady)).reduce((s,g)=>s+g.hours,0);
  $('stat-review').textContent=reviewList().filter(g=>g.occurrences.some(e=>!isReady(e))).length;$('stat-excluded').textContent=state.events.length-included.length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===state.filter));
  $('pagination').innerHTML='';
  if(state.filter==='summary'){
    $('event-list').innerHTML=state.categories.map(c=>{const items=groups.filter(g=>g.category===c.id);return `<div class="summary-row"><span>${esc(c.name)}<small style="display:block;color:#82929c">${items.length} мероприятий</small></span><b>${items.reduce((s,g)=>s+g.hours,0)} ч${items.some(g=>g.incomplete)?' · не все проверены':''}</b></div>`;}).join('');return;
  }
  const query=normalize($('search').value);
  const list=reviewList().filter(g=>(state.filter==='all'||(state.filter==='pending'&&g.occurrences.some(e=>!isReady(e)))||(state.filter==='excluded'&&g.excluded))&&normalize(g.title).includes(query));
  const pages=Math.max(1,Math.ceil(list.length/25));state.page=Math.min(state.page,pages-1);
  $('event-list').innerHTML=list.slice(state.page*25,(state.page+1)*25).map(g=>{
    const ready=g.occurrences.every(isReady);
    return `<div class="event ${g.excluded?'is-excluded':''}"><div><strong>${esc(g.title)}</strong><small>${esc(groupDescription(g))}</small><small>${esc(g.excluded?'Исключено':categoryName(g.category))}</small></div><div class="state"><span class="badge ${g.excluded?'excluded':ready?'':'pending'}">${g.excluded?'Исключено':ready?'Проверено':'Нужна проверка'}</span></div><div class="hours">${g.excluded?'—':g.incomplete?'?':g.hours}<small>акад. час</small></div><button data-edit="${g.id}">Изменить</button></div>`;
  }).join('')||'<div class="empty">Нет мероприятий по выбранному фильтру</div>';
  if(pages>1)$('pagination').innerHTML=`<button id="prev" ${state.page===0?'disabled':''}>← Назад</button><span>${state.page+1} / ${pages} · ${list.length} записей</span><button id="next" ${state.page===pages-1?'disabled':''}>Далее →</button>`;
  if($('prev'))$('prev').onclick=()=>{state.page--;render();};if($('next'))$('next').onclick=()=>{state.page++;render();};
  $('event-list').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(+b.dataset.edit,true));
}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;state.page=0;render();});$('search').oninput=()=>{state.page=0;render();};
$('reset').onclick=()=>{clearResult();message('Результат очищен. Исходные файлы сохранены до закрытия страницы.');};
function editingEvents(){return state.events.filter(e=>state.editing.includes(e.id));}
function editScope(){
  const multiple=editingEvents().length>1;
  $('edit-scope').textContent=$('edit-apply').checked
    ?'Раздел и введённая длительность применятся ко всем мероприятиям с исходным названием, включая записи в других разделах и в списке «Нужна проверка». Введённая длительность подтвердит их время; пустое поле сохранит время и статус проверки каждой записи. Число проведений у остальных записей не изменится.'
    :multiple?'Название, раздел, исключение и введённая длительность применятся ко всем показанным записям. Пустая длительность сохранит время каждой записи. Количество рассчитано автоматически; изменить отдельное проведение можно в исходных записях.':'Изменения сохранятся только для этой записи. Чтобы применить раздел и длительность ко всем мероприятиям с таким названием, поставьте галочку выше.';
}
function calculation(){
  const entries=editingEvents(),m=$('edit-minutes').value===''?null:Number($('edit-minutes').value),n=Number($('edit-count').value);
  const preview=entries.map(e=>({...e,minutes:m??e.minutes,count:entries.length>1?e.count:n,confirmed:m!==null||e.confirmed}));
  const g=groupEvents(preview)[0];
  $('edit-calculation').textContent=g&&!g.incomplete?`Занятий на ребёнка: ${g.count} → ${g.hours} акад. ч${g.unequal?' · нагрузка групп различается, учтён максимум':''}`:'Уточните длительность в исходных записях или задайте общую длительность.';
}
function edit(id,grouped=false){
  const e=state.events.find(e=>e.id===id),entries=grouped?reviewList().find(g=>g.id===id).occurrences:[e];state.editing=entries.map(e=>e.id);
  const multiple=entries.length>1,g=groupEvents(entries)[0];
  $('edit-source').textContent=multiple?groupDescription(g):`${e.date} · ячейка ${e.cell} · интервалы сетки: ${e.slot||'не указаны'}`;
  $('edit-raw').textContent=e.raw;$('edit-raw').hidden=multiple;
  $('edit-sources').hidden=!multiple;
  $('edit-sources').innerHTML=multiple?`<summary>Все исходные записи (${entries.length})</summary>`+entries.map(item=>`<div class="resolve-item"><small>${esc(item.date)} · ${esc(item.cell)} · ${esc(item.slot||'время не указано')}</small><p>${esc(item.raw)}</p><small>${item.minutes??'?'} мин · проведений: ${item.count}${item.reason?' · '+esc(item.reason):''}</small><button type="button" class="secondary" data-source="${item.id}">Изменить только эту запись</button></div>`).join(''):'';
  $('edit-sources').querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>edit(+b.dataset.source));
  $('edit-title').value=e.title;
  $('edit-minutes').value=entries.every(item=>item.minutes===e.minutes)?e.minutes??'':'';
  $('edit-minutes').placeholder=multiple?'Разная — сохранится по записям':'';
  $('edit-count').value=multiple?g.count:e.count;$('edit-count').disabled=multiple;
  $('edit-category').innerHTML=options(e.category);$('edit-excluded').checked=e.excluded;$('edit-apply').checked=false;
  editScope();
  $('edit-suggestion').textContent=[e.reason,e.suggestion?`Похожее: «${e.suggestion.title}» → ${categoryName(e.suggestion.category)}. Выберите раздел, если совпадение верно.`:e.match].filter(Boolean).join('. ');
  calculation();$('editor').showModal();
}
$('edit-minutes').oninput=calculation;$('edit-count').oninput=calculation;
$('edit-apply').onchange=editScope;
$('edit-form').onsubmit=e=>e.preventDefault();$('edit-cancel').onclick=()=>$('editor').close();document.querySelector('#editor .close').onclick=e=>{e.preventDefault();$('editor').close();};
$('edit-save').onclick=()=>{
  const entries=editingEvents(),multiple=entries.length>1,excluded=$('edit-excluded').checked;
  const minutes=$('edit-minutes').value===''?null:Number($('edit-minutes').value),count=Number($('edit-count').value),title=$('edit-title').value.trim(),category=$('edit-category').value;
  if($('edit-apply').checked&&category&&minutes!==null&&(!Number.isInteger(minutes)||minutes<0||minutes>1440)){
    $('edit-suggestion').textContent='Для применения ко всем мероприятиям укажите длительность 0–1440 минут.';return;
  }
  if(!excluded&&(!title||!category||(minutes===null?!multiple:!Number.isInteger(minutes)||minutes<0||minutes>1440)||(!multiple&&(!Number.isInteger(count)||count<1||count>999)))){
    $('edit-suggestion').textContent='Укажите название, раздел, длительность 0–1440 минут и число проведений 1–999. Ноль минут означает ноль часов.';return;
  }
  applyEventEdit(state.events,entries,{title,category,minutes,count,excluded,applyAll:$('edit-apply').checked});
  $('editor').close();render();if($('resolve').open)renderResolve();
};
function renderResolve(){
  const list=reviewList().filter(g=>g.occurrences.some(e=>!isReady(e)));$('resolve-message').textContent=list.length?`Осталось уточнить ${list.length} мероприятий. Одинаковые записи объединены. Выберите разделы и проверьте длительность.`:'Все мероприятия распределены, длительности проверены. Можно сохранить документ.';
  $('resolve-download').disabled=!!list.length||working;
  $('resolve-list').innerHTML=list.map(g=>`<div class="resolve-item"><strong>${esc(g.title)}</strong><small>${esc(groupDescription(g))}${g.incomplete?' · требуется проверка времени':''}</small><div class="input-action"><select aria-label="Раздел для ${esc(g.title)}" data-category="${g.id}">${options(g.category)}</select><button class="secondary" data-fix="${g.id}">Проверить время</button></div></div>`).join('');
  $('resolve-list').querySelectorAll('[data-category]').forEach(s=>s.onchange=()=>{for(const e of list.find(g=>g.id===+s.dataset.category).occurrences)e.category=s.value;render();renderResolve();});
  $('resolve-list').querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>edit(+b.dataset.fix,true));
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
