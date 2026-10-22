import {readWorkbook,readDocx,templateCategories,calendarDictionary,exampleDictionary,extractEvents,exportDocx,findPlanTable,children,nodes,attr} from '/src/files.js';
import {groupEvents,isReady} from '/src/core.js';
const log=[];
function assert(ok,name){if(!ok)throw Error(name);log.push('PASS '+name);}
try{
  const get=async p=>{const r=await fetch(p);if(!r.ok)throw Error(p);return r.arrayBuffer();};
  const [data,template,calendar,example]=await Promise.all(['/__test/plan.xlsx','/assets/template.docx','/assets/calendar.docx','/assets/example.docx'].map(get));
  const sheets=await readWorkbook(data);const sheet=sheets.find(s=>s.name==='ОКЕАН');
  assert(sheet?.programs.length===10,'10 программ на листе ОКЕАН');
  const t=await readDocx(template),c=await readDocx(calendar),e=await readDocx(example);
  const categories=templateCategories(t.xml);assert(categories.length===18,'18 разделов и модулей из шаблона');
  const dictionary=[...exampleDictionary(e.xml),...calendarDictionary(c.xml,categories)];
  const fixture={headerRow:1,timeCol:'C',merges:[],cells:new Map([
    ['B2','01.10.2026'],['C2','10:00-10:40'],['D2','Курс ДИТЦ 1 гр\nКурс ДИТЦ 2 гр'],
    ['B3','02.10.2026'],['C3','10:00-10:40'],['D3','Курс ДИТЦ (1 гр.)'],
    ['B4','03.10.2026'],['C4','10:00-10:40'],['D4','Курс ДИТЦ (2 гр.)'],
  ])};
  const repeated=extractEvents(fixture,'D',[{title:'Курс ДИТЦ',category:'2',source:'Пример'}],categories);
  const [course]=groupEvents(repeated);
  assert(repeated.length===4 && repeated.every(isReady),'Подгруппы распознаны и получили время слота');
  assert(course.hours===2 && course.count===2 && !course.unequal,'Четыре записи двух подгрупп = два занятия на ребёнка');
  const events=extractEvents(sheet,'P',dictionary,categories);
  assert(events.length>180,'Составные ячейки разделены на мероприятия');
  const opening=events.find(e=>e.cell==='P10');assert(opening.minutes===80,'Две строки с перерывом = 80 минут');
  const practice=events.find(e=>e.cell==='P78'&&e.title.includes('Новички'));assert(practice?.minutes===80&&practice.count===1,'Параллельные отряды: время слота, одно проведение');
  const duplicates=events.filter(e=>e.title.includes('океанариум'));assert(duplicates.length===2 && duplicates.filter(e=>e.excluded).length===1,'Повтор экскурсии в соседних строках не удваивает время');
  const unknown=events.find(e=>e.cell==='P12');assert(!unknown.confirmed,'Неопределённое время требует проверки');
  assert(!isReady({...opening,category:''}),'Неизвестный раздел блокирует экспорт');
  const groups=groupEvents(events.filter(e=>!e.excluded&&isReady(e)));
  // Test fixture only: deliberately exports ready records, not a deliverable curriculum.
  const blob=await exportDocx(template,groups,categories);
  const output=await readDocx(await blob.arrayBuffer());const table=findPlanTable(output.xml);const rows=children(table,'tr');
  assert(rows.length>40,'В DOCX записаны события и сохранены модули');
  assert(rows.slice(2).every(r=>nodes(r,'numId').length===7 && nodes(r,'numId').every(n=>attr(n,'val')==='0')),'В строках отключена прямая и унаследованная автонумерация Word');
  const cellValue=c=>nodes(c,'t').map(n=>n.textContent).join('');
  for(const category of categories){
    const items=groups.filter(g=>g.category===category.id);
    items.forEach((g,i)=>{
      const expected=`${category.id==='leisure'?'Д':category.id}.${i+1}`;
      assert(rows.some(r=>cellValue(children(r,'tc')[0])===expected && cellValue(children(r,'tc')[1])===g.title),'Номер мероприятия '+expected);
    });
  }
  const zeroBlob=await exportDocx(template,[{title:'Совещание вожатых',category:'2',hours:0}],categories);
  const zeroDoc=await readDocx(await zeroBlob.arrayBuffer());
  const zeroRow=children(findPlanTable(zeroDoc.xml),'tr').find(r=>cellValue(children(r,'tc')[1])==='Совещание вожатых');
  assert(zeroRow && cellValue(children(zeroRow,'tc')[2])==='0','Нулевые часы сохраняются в DOCX');
  assert(rows.slice(2).every(r=>children(r,'tc').slice(3).every(cell=>nodes(cell,'t').every(n=>!n.textContent))),'Теория, практика и аттестация не заполняются');
  assert(nodes(t.xml,'tbl').length===nodes(output.xml,'tbl').length,'Остальные таблицы сохранены');
  const originalTables=nodes(t.xml,'tbl'),outputTables=nodes(output.xml,'tbl');
  assert(originalTables.every((v,i)=>v===findPlanTable(t.xml)||new XMLSerializer().serializeToString(v)===new XMLSerializer().serializeToString(outputTables[i])),'Неизменённые таблицы совпадают с шаблоном');
  const originalParts=Object.keys(t.zip.files);assert(originalParts.length===Object.keys(output.zip.files).length,'Состав DOCX сохранён');
  for(const name of originalParts)if(name!=='word/document.xml'&&!t.zip.files[name].dir){const a=await t.zip.file(name).async('base64'),b=await output.zip.file(name).async('base64');assert(a===b,'Сохранён '+name);}
  const a=document.getElementById('download');a.href=URL.createObjectURL(blob);a.download='qa-plan.docx';a.hidden=false;
  log.unshift(`ИТОГ: ${events.length} записей, ${events.filter(e=>!isReady(e)).length} требуют проверки, ${groups.length} готовых групп.`);
  document.getElementById('result').textContent=log.join('\n');
}catch(e){document.getElementById('result').textContent=log.join('\n')+'\nFAIL '+e.stack;}
