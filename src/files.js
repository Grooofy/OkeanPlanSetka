import { normalize, ranges, splitEvents, cleanTitle, inferOccurrence,groupIds } from './core.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const nodes = (node, name) => [...node.getElementsByTagNameNS('*', name)];
export const children = (node, name) => [...node.children].filter(n=>n.localName===name);
export const attr = (node, name) => node?.getAttribute(name) || node?.getAttribute('w:'+name) || '';
export const parseXml = text => { const d = new DOMParser().parseFromString(text,'application/xml'); if (nodes(d,'parsererror').length) throw Error('Повреждён XML внутри файла'); return d; };
const cellText = c => nodes(c,'p').map(p=>nodes(p,'t').map(t=>t.textContent).join('')).join('\n');
export async function openZip(data) {
  if (data.byteLength > 30*1024*1024 || data.size > 30*1024*1024) throw Error('Размер файла больше 30 МБ');
  const zip = await window.JSZip.loadAsync(data);
  const entries = Object.values(zip.files);
  if (entries.length > 10000 || entries.reduce((s,e)=>s+(e._data?.uncompressedSize||0),0)>150*1024*1024) throw Error('Слишком большой распакованный документ');
  return zip;
}
export async function readWorkbook(data) {
  const zip = await openZip(data);
  if (!zip.file('xl/workbook.xml')) throw Error('Выберите файл XLSX (не XLS и не CSV)');
  const wb = parseXml(await zip.file('xl/workbook.xml').async('string'));
  const rel = parseXml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
  const targets = Object.fromEntries(nodes(rel,'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const strings = zip.file('xl/sharedStrings.xml') ? nodes(parseXml(await zip.file('xl/sharedStrings.xml').async('string')),'si').map(s=>nodes(s,'t').map(t=>t.textContent).join('')) : [];
  const result = [];
  for (const sh of nodes(wb,'sheet')) {
    const target = targets[sh.getAttribute('r:id')];
    const filename = target.startsWith('/') ? target.slice(1) : 'xl/'+target.replace(/^\.\//,'');
    if (!zip.file(filename)) continue;
    const xml = parseXml(await zip.file(filename).async('string'));
    const cells = new Map();
    for (const c of nodes(xml,'c')) {
      const v = nodes(c,'v')[0]?.textContent || '';
      const value = c.getAttribute('t')==='s' ? strings[+v] : c.getAttribute('t')==='inlineStr' ? nodes(c,'t').map(t=>t.textContent).join('') : v;
      if (value !== '') cells.set(c.getAttribute('r'),value);
    }
    const merges = nodes(xml,'mergeCell').map(m=>m.getAttribute('ref'));
    const headers = [...cells].filter(([,v])=>normalize(v)==='время');
    if (!headers.length) continue;
    const [timeRef] = headers[0], headerRow = +timeRef.match(/\d+/)[0], timeCol = timeRef.replace(/\d/g,'');
    const programs = [...cells].filter(([ref,v])=>+ref.match(/\d+/)[0]===headerRow && colNum(ref)>colNum(timeCol) && normalize(v)!=='мп').map(([ref,v])=>({ col:ref.replace(/\d/g,''),title:v.split('\n')[0].trim(),label:v }));
    if (programs.length) result.push({ name:sh.getAttribute('name'),cells,merges,timeCol,headerRow,programs });
  }
  if (!result.length) throw Error('Не найдены листы со столбцом «время». Нужен формат исходной план-сетки.');
  return result;
}
function colNum(ref) { return [...ref.replace(/\d/g,'')].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0); }
function excelDate(v) {
  if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899,11,30)+Number(v)*86400000).toLocaleDateString('ru-RU',{timeZone:'UTC'});
  return String(v||'').split('\n')[0];
}
export function extractEvents(sheet, col, dictionary, categories) {
  const events = [], seen = new Map(); let date='';
  const rows = [...sheet.cells.keys()].map(k=>+k.match(/\d+/)[0]);
  const max = Math.max(...rows);
  for (let row=sheet.headerRow+1; row<=max; row++) {
    if (sheet.cells.has('B'+row)) date=excelDate(sheet.cells.get('B'+row));
    const ref=col+row, raw=sheet.cells.get(ref);
    if (!raw) continue;
    const merge=sheet.merges.find(m=>m.split(':')[0]===ref);
    const end=merge ? +merge.split(':')[1].match(/\d+/)[0] : row;
    const slots=[];
    for (let r=row;r<=end;r++) slots.push(...ranges(sheet.cells.get(sheet.timeCol+r)||''));
    const lines=splitEvents(raw);
    const allGroups=lines.flatMap(groupIds);
    const parallel=lines.length>1 && lines.every(l=>groupIds(l).length) && new Set(allGroups).size===allGroups.length;
    for (const line of lines) {
      const title=cleanTitle(line); if (!title) continue;
      const found=matchCategory(title,dictionary,categories);
      const timing=inferOccurrence(line,slots,lines.length>1&&!parallel);
      if (/^\s*\d{1,2}:\d{2}(?!\s*[-–—])/.test(line) && !ranges(line).length) { timing.reason='Указано только начало: уточните длительность'; timing.confirmed=false; timing.minutes=null; }
      const explicit=ranges(line);
      const duplicateKey=normalize(line)+'|'+date+'|'+explicit.map(i=>i.raw).join('|');
      const duplicate=explicit.length===1 && seen.has(duplicateKey);
      const routine=/^(полдник|завтрак|обед|ужин|подъ[её]м|отбой|сдача денег|запись на экскурсию)/i.test(title);
      const e={id:events.length+1,title,raw:line,cell:ref,date,slot:slots.map(i=>i.raw).join(', '),...timing,category:found.category,match:found.source,excluded:!!duplicate || (routine && !found.fromExample), exclusion:duplicate?'Повтор того же интервала и мероприятия':routine&&!found.fromExample?'Режимная запись отсутствует в примере':'',suggestion:found.suggestion};
      events.push(e); if (explicit.length===1) seen.set(duplicateKey,e.id);
    }
  }
  return events;
}
export function matchCategory(title, dictionary, categories) {
  const key=normalize(title);
  const matches=dictionary.filter(e=>normalize(e.title)===key);
  const fromExample=matches.filter(e=>e.source==='Пример');
  const candidates=fromExample.length?fromExample:matches;
  const ids=[...new Set(candidates.map(e=>e.category))].filter(id=>categories.some(c=>c.id===id));
  if(ids.length===1) return {category:ids[0],source:candidates[0].source,fromExample:!!fromExample.length};
  const words=new Set(key.split(' ').filter(s=>s.length>3));
  let best=null,score=0;
  for(const item of dictionary){const other=new Set(normalize(item.title).split(' ').filter(s=>s.length>3));const common=[...words].filter(w=>other.has(w)).length;const s=common/(new Set([...words,...other]).size||1);if(s>score){score=s;best=item;}}
  return {category:'',source:ids.length>1?'Несколько совпадений':'Нет точного совпадения',fromExample:false,suggestion:score>=0.45?best:null};
}
export async function readDocx(data) {
  const zip=await openZip(data); const file=zip.file('word/document.xml');
  if(!file) throw Error('Выберите документ DOCX');
  return {zip,xml:parseXml(await file.async('string'))};
}
export function findPlanTable(xml) { return nodes(xml,'tbl').find(t=>cellText(t).includes('Общая трудоёмкость') && cellText(t).includes('Раздел 1.')); }
export function templateCategories(xml) {
  const table=findPlanTable(xml); if(!table) throw Error('В шаблоне не найдена таблица учебного плана с общей трудоёмкостью');
  const categories=[];
  for(const row of children(table,'tr')){
    const cells=children(row,'tc'),texts=cells.map(cellText); const name=texts[1]||'';
    if(/^Раздел [12]\./.test(name)) categories.push({id:name.match(/^Раздел (\d)/)[1],name});
    else if(/^Модуль/.test(name)) categories.push({id:texts[0].trim().replace(/\.$/,''),name});
    else if(/^Досуговая деятельность/.test(texts[0])) categories.push({id:'leisure',name:'Досуговая деятельность'});
  }
  if(!categories.some(c=>c.id==='1') || !categories.some(c=>c.id==='2') || !categories.some(c=>c.id.startsWith('3.'))) throw Error('Шаблон должен содержать разделы 1, 2 и модули раздела 3');
  return categories;
}
export function exampleDictionary(xml) {
  const table=findPlanTable(xml); if(!table) throw Error('В примере не найдена таблица учебного плана');
  const out=[]; let category='';
  for(const row of children(table,'tr')){
    const text=children(row,'tc').map(cellText),name=text[1]||'';
    if(/^Раздел [123]\./.test(name)) {category=name.match(/^Раздел (\d)/)[1];continue;}
    if(/^Модуль/.test(name)){category=text[0].trim().replace(/\.$/,'');continue;}
    if(/^Досуговая деятельность/.test(text[0])){category='leisure';continue;}
    if(/^(Итого|ВСЕГО|БЛОК)/i.test(text[0])){if(!/^БЛОК/.test(text[0])) category='';continue;}
    if(category && category!=='3' && name && !/^[-–\s]+$/.test(name)) for(const title of name.split(/\s+\/\s+/)) out.push({title:title.trim(),category,source:'Пример'});
  }
  return out;
}
export function calendarDictionary(xml,categories) {
  const out=[];
  for(const table of nodes(xml,'tbl')){
    let category='';
    for(const row of children(table,'tr')){
      const texts=children(row,'tc').map(cellText); if(texts.length<2) continue;
      const match=texts[0].match(/^\s*(\d{1,2})\.\s*\S/);
      if(match) category='3.'+Number(match[1]);
      if(/^Блок|^Модуль/.test(texts[0])) category='';
      const description=texts.find((v,i)=>i>0 && /Цель\s*:/i.test(v));
      if(!description || !categories.some(c=>c.id===category)) continue;
      const title=description.split(/Цель\s*:/i)[0].trim().replace(/\n/g,' ');
      if(title) out.push({title,category,source:'Календарный план'});
    }
  }
  if(!out.length) throw Error('В календарном плане не найдены мероприятия с модулем и полем «Цель:»');
  return out;
}
function setText(cell,text){
  const doc=cell.ownerDocument; const oldP=children(cell,'p')[0]; const p=doc.createElementNS(W,'w:p');
  const pPr=oldP && children(oldP,'pPr')[0]; if(pPr)p.appendChild(pPr.cloneNode(true));
  const r=doc.createElementNS(W,'w:r'),rp=doc.createElementNS(W,'w:rPr');
  const font=doc.createElementNS(W,'w:rFonts');font.setAttributeNS(W,'w:ascii','Times New Roman');font.setAttributeNS(W,'w:hAnsi','Times New Roman');rp.appendChild(font);
  const sz=doc.createElementNS(W,'w:sz');sz.setAttributeNS(W,'w:val','24');rp.appendChild(sz);r.appendChild(rp);
  const t=doc.createElementNS(W,'w:t');t.textContent=String(text);r.appendChild(t);p.appendChild(r);
  for(const child of [...cell.children]) if(child.localName!=='tcPr')child.remove();
  cell.appendChild(p);
}
export async function exportDocx(templateData,groups,categories){
  const {zip,xml}=await readDocx(templateData); const table=findPlanTable(xml);
  if(!table) throw Error('Таблица учебного плана не найдена');
  const rows=children(table,'tr');
  const plain=rows.find((r,i)=>i>1 && children(r,'tc').length===7 && !nodes(r,'vMerge').length && children(r,'tc').every(c=>!cellText(c).trim()));
  if(!plain) throw Error('В шаблоне нужна пустая строка из 7 отдельных ячеек');
  const prototype=plain.cloneNode(true);
  // Preserve the source table grid, borders and two header rows; rebuild only its data rows.
  for(const row of rows.slice(2))row.remove();
  for(const row of rows.slice(0,2)){
    let pr=children(row,'trPr')[0];if(!pr){pr=xml.createElementNS(W,'w:trPr');row.prepend(pr);}
    if(!children(pr,'tblHeader').length)pr.appendChild(xml.createElementNS(W,'w:tblHeader'));
  }
  function add(number,name,hours,bold=false){
    const row=prototype.cloneNode(true); nodes(row,'trHeight').forEach(n=>n.remove());
    const cells=children(row,'tc');[number,name,hours,'','','',''].forEach((v,i)=>setText(cells[i],v));
    if(bold)for(const rp of nodes(row,'rPr'))rp.appendChild(xml.createElementNS(W,'w:b'));
    table.appendChild(row);
  }
  const sum=items=>items.reduce((n,g)=>n+g.hours,0);
  let ocean=false;
  for(const c of categories){
    if(c.id.startsWith('3.')&&!ocean){add('3.','Раздел 3. Океанские практики',sum(groups.filter(g=>g.category.startsWith('3.'))),true);ocean=true;}
    const block={'3.1':'БЛОК «МИР»','3.6':'БЛОК «РОССИЯ»','3.11':'БЛОК «ЧЕЛОВЕК»'}[c.id];if(block)add('',block,'',true);
    if(c.id==='leisure')add('','Итого',sum(groups.filter(g=>g.category!=='leisure')),true);
    const items=groups.filter(g=>g.category===c.id);
    add(c.id==='leisure'?'':c.id+'.',c.name,items.length?sum(items):'–',true);
    if(!items.length)add('','–','–');
    else items.forEach((g,i)=>add(`${c.id==='leisure'?'Д':c.id}.${i+1}`,g.title,g.hours));
  }
  add('','ВСЕГО',sum(groups),true);
  zip.file('word/document.xml',new XMLSerializer().serializeToString(xml),{createFolders:false});
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
