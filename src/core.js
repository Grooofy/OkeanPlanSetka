export const normalize = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»“”„"!?.:,;()–—\-]/g, ' ').replace(/\s+/g, ' ').trim();
export function academicHours(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return Math.ceil(minutes / 40);
}
export function ranges(text) {
  return [...String(text).matchAll(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/g)].map(m => {
    const start = +m[1] * 60 + +m[2], end = +m[3] * 60 + +m[4];
    return { start, end, raw: m[0], valid: +m[1] < 24 && +m[3] < 24 && +m[2] < 60 && +m[4] < 60 && end > start };
  });
}
export function intervalMinutes(intervals) {
  const sorted = intervals.filter(i => i.valid !== false && i.end > i.start).sort((a,b) => a.start-b.start);
  let total = 0, end = -1;
  for (const i of sorted) { total += Math.max(0, i.end - Math.max(i.start, end)); end = Math.max(end, i.end); }
  return total;
}
export function cleanTitle(text) {
  return stripAudience(text).replace(/\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*[-–—]?/g, '')
    .replace(/^\s*\d{1,2}:\d{2}\s*/, '')
    .replace(/\([^)]*(?:отр(?:\.|\s|\))|отряд|гр\.|чел\.|мин\.|\d{1,2}:\d{2})[^)]*\)/gi, '')
    .replace(/\(\s*[,;]*\s*\)/g, '').replace(/\s+/g, ' ').replace(/^\s*[-–—,;]\s*|\s*[-–—,;]\s*$/g, '').trim();
}
export function splitEvents(text) {
  // Newlines are event separators only when the following line is not a continuation.
  const lines = String(text).split(/\r?\n|\s+\/\s+/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (out.length && (/^(?:\(|[«"“]|посвящ[её]н|от специалистов|и |\/)/i.test(line) || (audienceMatches(line).length && !stripAudience(line).replace(/[\s,;()]/g,'')))) out[out.length-1] += ' ' + line;
    else out.push(line);
  }
  return out;
}
// Require a participant marker; numbers in course names are meaningful.
const audiencePattern = /(?<![\d\p{L}])([1-9]\d*(?:\s*(?:,|и|[-–—])\s*[1-9]\d*)*)\s*(подгрупп(?:а|ы|у)?|п\/гр\.?|групп(?:а|ы|у)?|гр\.?|отряд(?:а|ы|ов)?|отр\.)(?![\p{L}\d])/giu;
function audienceMatches(text) { return [...String(text).matchAll(audiencePattern)]; }
function stripAudience(text) { return String(text).replace(audiencePattern, ''); }
export function audience(text) {
  const result = { squads: [], subgroups: [] };
  for (const m of audienceMatches(text)) {
    const target = /^отр/i.test(m[2]) ? result.squads : result.subgroups;
    const expanded = m[1].replace(/(\d+)\s*[-–—]\s*(\d+)/g, (_, a, b) => {
      a=+a;b=+b;
      return b>=a && b-a<100 ? Array.from({length:b-a+1},(_,i)=>a+i).join(',') : `${a},${b}`;
    });
    target.push(...expanded.match(/\d+/g).map(Number));
  }
  return {squads:[...new Set(result.squads)],subgroups:[...new Set(result.subgroups)]};
}
export function groupIds(text) {
  const a=audience(text);
  return a.squads.length ? a.squads.map(id=>'отр:'+id) : a.subgroups.map(id=>'гр:'+id);
}
export function parallelAudiences(lines) {
  const all=lines.map(audience);
  return all.length>1 && all.every((a,i)=>all.slice(i+1).every(b=>
    (a.squads.length && b.squads.length && !a.squads.some(id=>b.squads.includes(id))) ||
    (a.subgroups.length && b.subgroups.length && !a.subgroups.some(id=>b.subgroups.includes(id)))));
}
export function inferOccurrence(text, slotIntervals, complex) {
  const explicit = ranges(text);
  const minutesText = text.match(/(?:по\s+)?(\d+)\s*[-–]?(?:минут[а-я]*|мин\b)/i);
  let minutes = null, reason = '';
  if (explicit.length && explicit.every(i=>i.valid)) minutes = intervalMinutes(explicit);
  else if (explicit.length) reason = 'Некорректный интервал в тексте';
  else if (minutesText) minutes = +minutesText[1];
  else if (!complex && slotIntervals.length) minutes = intervalMinutes(slotIntervals);
  else reason = complex ? 'Несколько мероприятий в одной ячейке: уточните длительность' : 'Не найдено время проведения';
  if (explicit.length > 1 || /один отряд|второй отряд|по \d+ мин/i.test(text)) reason = 'Несколько проведений: проверьте длительность одного и количество';
  // A child attends once even when several squads/subgroups attend the session.
  const count = 1;
  if (/\d+\s+отряда?(?:\s|\)|,|$)/u.test(text)) reason = reason || 'Проверьте число проведений для указанных отрядов';
  return { minutes, count, reason, confirmed: !reason };
}
export function groupEvents(events) {
  const groups = new Map();
  for (const e of events) {
    const key = normalize(e.title) + '|' + e.category;
    if (!groups.has(key)) groups.set(key, { title: e.title, category: e.category, hours: 0, occurrences: [], incomplete: false });
    const g = groups.get(key); g.occurrences.push(e);
    const h = academicHours(e.minutes);
    if (h === null || !Number.isInteger(e.count) || e.count < 1 || !e.confirmed) g.incomplete = true;
  }
  for(const g of groups.values()) {
    const entries=g.occurrences.map(e=>({e,a:audience(e.raw||'')}));
    const squads=[...new Set(entries.flatMap(({a})=>a.squads))];
    const subgroups=[...new Set(entries.flatMap(({a})=>a.subgroups))];
    const totals=[];
    for(const squad of squads.length?squads:[null]) for(const subgroup of subgroups.length?subgroups:[null]) {
      let hours=0,count=0;
      for(const {e,a} of entries) {
        if((a.squads.length&&!a.squads.includes(squad)) || (a.subgroups.length&&!a.subgroups.includes(subgroup))) continue;
        if(Number.isInteger(e.count)&&e.count>0) count+=e.count;
        const h=academicHours(e.minutes);
        if(h!==null && e.confirmed && Number.isInteger(e.count)&&e.count>0) hours+=h*e.count;
      }
      totals.push({squad,subgroup,hours,count});
    }
    g.hours=Math.max(...totals.map(t=>t.hours));
    g.count=Math.max(...totals.map(t=>t.count));
    g.audiences=totals;
    g.unequal=new Set(totals.map(t=>`${t.hours}|${t.count}`)).size>1;
  }
  return [...groups.values()];
}
export function reviewGroups(events) {
  return [false,true].flatMap(excluded=>groupEvents(events.filter(e=>!!e.excluded===excluded)).map(g=>({...g,excluded,id:g.occurrences[0].id})));
}
export function isReady(e) { return e.excluded || (!!e.category && !!e.confirmed && academicHours(e.minutes) !== null && Number.isInteger(e.count) && e.count > 0 && !!e.title.trim()); }
export function googleExportUrl(input) {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') throw Error('Нужна ссылка https://docs.google.com/spreadsheets/…');
  const id = u.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) throw Error('Не найден идентификатор таблицы');
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}
