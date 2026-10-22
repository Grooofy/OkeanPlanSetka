import test from 'node:test';
import assert from 'node:assert/strict';
import {academicHours,ranges,intervalMinutes,inferOccurrence,groupEvents,reviewGroups,audience,parallelAudiences,isReady,googleExportUrl,cleanTitle,splitEvents} from '../src/core.js';
test('40-minute academic hours round each occurrence up; explicit zero is valid',()=>{assert.equal(academicHours(40),1);assert.equal(academicHours(60),2);assert.equal(academicHours(80),2);assert.equal(academicHours(0),0);for(const v of [NaN,null,undefined,'',-1])assert.equal(academicHours(v),null);});
test('merged cells exclude breaks and overlapping slots do not double count',()=>{assert.equal(intervalMinutes(ranges('19:30-20:10, 20:15-20:55')),80);assert.equal(intervalMinutes(ranges('14:35-16:00, 14:35-15:15, 15:20-16:00')),85);});
test('repeated unlabelled sessions contribute, rounding before aggregation',()=>{const records=[{title:'Курс',category:'2',minutes:60,count:3,confirmed:true},{title:'Курс',category:'2',minutes:40,count:1,confirmed:true}];assert.equal(groupEvents(records)[0].hours,7);});
test('unknown timing cannot silently contribute zero or export',()=>{const e={title:'Курс',category:'2',minutes:null,count:1,confirmed:false};assert.equal(groupEvents([e])[0].incomplete,true);assert.equal(isReady(e),false);assert.equal(isReady({...e,excluded:true}),true);});
test('ambiguous multi-event cells require review',()=>{const slots=ranges('09:45-10:25, 10:30-11:10');assert.equal(inferOccurrence('Курс',slots,false).minutes,80);assert.equal(inferOccurrence('Курс',slots,true).confirmed,false);assert.equal(inferOccurrence('11:00-11:20 Презентация',slots,true).minutes,20);});
test('multiple explicit group sessions require review',()=>assert.equal(inferOccurrence('один отряд 09:45-10:20, второй отряд 10:30-11:10',[],true).confirmed,false));
test('clean names aggregate groups without erasing meaningful qualifiers',()=>{assert.equal(cleanTitle('Практика «Новички в деле» (1 отр.)'),'Практика «Новички в деле»');assert.equal(cleanTitle('Спектакль (зрители)'),'Спектакль (зрители)');});
test('Google import only allows expected host and extracts ID',()=>{assert.equal(googleExportUrl('https://docs.google.com/spreadsheets/d/abc-123/edit?gid=1'),'https://docs.google.com/spreadsheets/d/abc-123/export?format=xlsx');assert.throws(()=>googleExportUrl('https://example.com/spreadsheets/d/abc'));});
test('slash-delimited source events split without damaging abbreviations',()=>assert.deepEqual(splitEvents('Практика (1 отр.) / О/д «Родина»'),['Практика (1 отр.)','О/д «Родина»']));
test('group IDs never multiply hours per child',()=>{assert.equal(inferOccurrence('Курс (3 отр.)',ranges('10:00-10:40'),false).count,1);assert.equal(inferOccurrence('Курс (1, 2 отр.)',ranges('10:00-10:40'),false).count,1);});

const event=(raw,extra={})=>({title:cleanTitle(raw),raw,category:'2',minutes:40,count:1,confirmed:true,...extra});
test('zero hours retain the event and allow export only after confirmation',()=>{
  const e=event('Совещание вожатых',{minutes:0});
  assert.equal(isReady(e),true);assert.equal(groupEvents([e])[0].hours,0);
  assert.equal(isReady({...e,confirmed:false}),false);
});
test('subgroup spellings normalize without erasing course numbers',()=>{
  for(const suffix of ['1 гр','(2 гр.)','1 группа','2 подгруппа','1, 2 гр.','1–2 гр.'])assert.equal(cleanTitle('Курс ДИТЦ '+suffix),'Курс ДИТЦ');
  assert.deepEqual(audience('Курс (1, 2 отр.) 1–3 гр.'),{squads:[1,2],subgroups:[1,2,3]});
  assert.equal(cleanTitle('Курс 2 (продвинутый)'),'Курс 2 (продвинутый)');
});
test('repeated lessons aggregate across dates, with subgroups counted per child',()=>{
  const events=[1,2,3].flatMap(day=>[1,2].map(group=>event(`Курс ДИТЦ ${group} гр`,{date:`${day}.10.2026`,id:day*10+group})));
  const [g]=groupEvents(events);
  assert.equal(g.hours,3);assert.equal(g.count,3);assert.equal(g.occurrences.length,6);assert.equal(g.unequal,false);
  assert.equal(reviewGroups(events).length,1);
});
test('alternating subgroup dates do not double count a course',()=>{
  const [g]=groupEvents([event('Курс 1 гр',{date:'1.10'}),event('Курс 2 гр',{date:'2.10'})]);
  assert.equal(g.hours,1);assert.equal(g.count,1);
});
test('common lessons add to each subgroup; unequal loads are visible',()=>{
  const [g]=groupEvents([event('Курс'),event('Курс 1 гр',{minutes:60}),event('Курс 2 гр')]);
  assert.equal(g.hours,3);assert.equal(g.count,2);assert.equal(g.unequal,true);
  assert.deepEqual(g.audiences.map(a=>a.hours),[3,2]);
});
test('squads and their nested subgroups do not multiply hours',()=>{
  const [g]=groupEvents([event('Курс (1 отр.) 1 гр'),event('Курс (1 отр.) 2 гр'),event('Курс (2 отр.) 1 гр'),event('Курс (2 отр.) 2 гр')]);
  assert.equal(g.hours,1);assert.equal(g.count,1);
});
test('rounding is per lesson, not after adding minutes',()=>{
  const [g]=groupEvents([event('Курс 1 гр',{minutes:50}),event('Курс 1 гр',{minutes:50}),event('Курс 2 гр',{minutes:50}),event('Курс 2 гр',{minutes:50})]);
  assert.equal(g.hours,4);
});
test('excluded sources stay separate during grouped review',()=>{
  const groups=reviewGroups([event('Курс',{id:1}),event('Курс',{id:2,excluded:true})]);
  assert.equal(groups.length,2);assert.equal(groups[0].occurrences.length,1);
});
test('parallel time is safe only for disjoint participant sets',()=>{
  assert.equal(parallelAudiences(['Курс 1 гр','Практика 2 гр']),true);
  assert.equal(parallelAudiences(['Курс 1 гр','Практика 1 гр']),false);
  assert.equal(parallelAudiences(['Курс (1 отр.)','Практика 2 гр']),false);
  assert.equal(parallelAudiences(['Курс','Практика']),false);
});
test('a subgroup marker on a separate line belongs to the preceding event',()=>{
  assert.deepEqual(splitEvents('Курс ДИТЦ\n1 гр\nПрактика\n2 гр.'),['Курс ДИТЦ 1 гр','Практика 2 гр.']);
});
