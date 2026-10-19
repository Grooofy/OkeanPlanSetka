export const normalize = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»“”„"!?.:,;()–—\-]/g, ' ').replace(/\s+/g, ' ').trim();
export function academicHours(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
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
  return text.replace(/\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*[-–—]?/g, '')
    .replace(/^\s*\d{1,2}:\d{2}\s*/, '')
    .replace(/\([^)]*(?:отр(?:\.|\s|\))|отряд|гр\.|чел\.|мин\.|\d{1,2}:\d{2})[^)]*\)/gi, '')
    .replace(/\s+/g, ' ').replace(/^\s*[-–—]\s*/, '').trim();
}
export function splitEvents(text) {
  // Newlines are event separators only when the following line is not a continuation.
  const lines = String(text).split(/\r?\n|\s+\/\s+/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (out.length && /^(?:\(|[«"“]|посвящ[её]н|от специалистов|и |\/)/i.test(line)) out[out.length-1] += ' ' + line;
    else out.push(line);
  }
  return out;
}
export function groupIds(text) {
  const m=text.match(/\(([\d\s,и]+)\s*(?:отр\.|отряд(?:а|ы|ов)?)\s*\)/i);
  return m ? [...new Set(m[1].match(/\d+/g))] : [];
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
  // “(1, 2 отр.)” is two separate groups; “(2 отр.)” means group #2, not two sessions.
  const count = groupIds(text).length || 1;
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
    else g.hours += h * e.count;
  }
  return [...groups.values()];
}
export function isReady(e) { return e.excluded || (!!e.category && !!e.confirmed && academicHours(e.minutes) !== null && Number.isInteger(e.count) && e.count > 0 && !!e.title.trim()); }
export function googleExportUrl(input) {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') throw Error('Нужна ссылка https://docs.google.com/spreadsheets/…');
  const id = u.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) throw Error('Не найден идентификатор таблицы');
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}
