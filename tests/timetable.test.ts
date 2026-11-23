import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandTimetable, parseWeeks, weekdayNumber, dateOnly, previewTimetable } from '../server/timetable';
import { timetableDraft, importTimetable, undoTimetable } from '../server/timetable-store';
import { timetablePreview, sheetRows } from '../server/sheets';
import { zipSync, strToU8 } from 'fflate';
import { Store } from '../server/db';
const row = {title:'高等数学',weekday:'周一',weeks:'1-6(单)',start:'08:00',end:'09:30',location:'A101'};
const term = {weekOneMonday:'2026-10-26',weekCount:6};
function store() { return new Store(mkdtempSync(join(tmpdir(),'zhixu-term-'))); }
test('weeks support parity, ranges, lists and per-segment parity without guessing',()=>{
  assert.deepEqual(parseWeeks('第1-6周（单周）',6),[1,3,5]);
  assert.deepEqual(parseWeeks('1-4(单),4-8(双)',8),[1,3,4,6,8]);
  assert.deepEqual(parseWeeks('1-3,5,5',6),[1,2,3,5]);
  assert.deepEqual(parseWeeks('双周',6),[2,4,6]);
  assert.deepEqual(parseWeeks('每周',3),[1,2,3]);
  assert.deepEqual(parseWeeks('1-4,6-8(单)',8),[1,3,7]);
  for(const value of ['', '0-3', '5-2', '1-7', '约1-3', '2(单)', '1,,3']) assert.throws(()=>parseWeeks(value,6));
});
test('weekday and dates reject ambiguous or impossible values',()=>{
  assert.equal(weekdayNumber('星期天'),7); assert.equal(weekdayNumber(3),3);
  for(const day of ['',0,8,'一二','周末']) assert.throws(()=>weekdayNumber(day));
  for(const date of ['2026-02-29','2026-13-01','2026-04-31','2026-1-01']) assert.throws(()=>dateOnly(date));
  assert.ok(Number.isFinite(dateOnly('2028-02-29')));
});
test('semester expansion preserves date-only arithmetic across DST and year boundaries',()=>{
  const result=expandTimetable([row],term);
  assert.deepEqual(result.items.map(x=>x.date),['2026-10-26','2026-11-09','2026-11-23']);
  assert.deepEqual(result.items.map(x=>x.week),[1,3,5]);
  assert.equal(expandTimetable([{...row,weekday:'周日',weeks:'每周'}],{weekOneMonday:'2026-12-28',weekCount:2}).items[1].date,'2027-01-10');
  assert.throws(()=>expandTimetable([row],{...term,weekOneMonday:'2026-10-27'}),/星期一/);
  assert.throws(()=>expandTimetable([row],{...term,weekCount:54}),/周数/);
});
test('specific dates win, exclusions are explicit and periods use user school mapping',()=>{
  const result=expandTimetable([{...row,date:'2026-10-27'},{...row,start:'',end:'',periods:'第1-2节'}],{...term,skipDates:['2026-11-09'],periods:[{number:1,start:'08:00',end:'08:45'},{number:2,start:'08:55',end:'09:40'}]});
  assert.equal(result.excluded,1); assert.equal(result.items.length,3);
  assert.equal(result.items[0].end,'09:40'); assert.equal(result.items[1].date,'2026-10-27');
  assert.equal(result.items[1].week,undefined);
  assert.throws(()=>expandTimetable([{...row,start:'',end:'',periods:'1-2'}],term),/第 1 节|节次/);
  assert.throws(()=>expandTimetable([{...row,start:'',end:'',periods:'1-2'}],{...term,periods:[{number:1,start:'08:00',end:'09:00'},{number:2,start:'08:30',end:'09:40'}]}),/重叠/);
  assert.throws(()=>expandTimetable([{...row,end:''}],term),/起止时间/);
});
test('preview deduplicates identical occurrences and reports existing and internal overlaps',()=>{
  const existing=[{...row,date:'2026-10-26'}];
  const p=previewTimetable([row,row,{...row,title:'英语',start:'09:00',end:'10:00'}],term,'',existing,[{title:'复习',date:'2026-11-09',start:'08:30',end:'08:45'}]);
  assert.equal(p.duplicates,4); assert.equal(p.items.length,5); assert.equal(p.conflictCount,4);
  assert.equal(existing.length,1);
  assert.equal(previewTimetable([{...row,date:'2026-10-26',start:'09:30',end:'10:00'}],{},'',existing,[]).conflictCount,0);
});
test('CSV and XLSX retain weekday, week range and period fields without silent truncation',()=>{
  const parsed=timetablePreview([['课程','星期','周次','节次'],['数学','周一','1-6(单)','1-2']]);
  assert.equal(parsed[0].periods,'1-2'); assert.equal(parsed[0].weekday,'周一');
  const xml='<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>课程</t></is></c><c r="B1" t="inlineStr"><is><t>星期</t></is></c><c r="C1" t="inlineStr"><is><t>周次</t></is></c><c r="D1" t="inlineStr"><is><t>节次</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>数学</t></is></c><c r="B2"><v>1</v></c><c r="C2" t="inlineStr"><is><t>1-6(单)</t></is></c><c r="D2" t="inlineStr"><is><t>1-2</t></is></c></row></sheetData></worksheet>';
  const bytes=zipSync({'xl/worksheets/sheet1.xml':strToU8(xml)});
  assert.equal(timetablePreview(sheetRows(bytes,'test.xlsx'))[0].periods,'1-2');
  assert.throws(()=>timetablePreview([['课程'],...Array.from({length:501},()=>['数学'])]),/500/);
});
test('import is atomic, requires fresh preview and conflict acknowledgement; repeated import adds nothing',()=>{
  const db=store();
  try {
    const input={rows:[row],term}; const draft=timetableDraft(db,input);
    assert.equal(db.list('timetable').length,0);
    assert.throws(()=>importTimetable(db,{...input,digest:'wrong'}),/预览/);
    db.put('plan',{date:'2026-10-26',start:'08:30',end:'09:00',title:'已有计划'});
    assert.throws(()=>importTimetable(db,{...input,digest:draft.digest,acceptConflicts:true}),/预览/);
    const next=timetableDraft(db,input);
    assert.throws(()=>importTimetable(db,{...input,digest:next.digest}),/冲突/);
    assert.equal(db.list('timetable').length,0);
    const imported=importTimetable(db,{...input,digest:next.digest,acceptConflicts:true});
    assert.equal(imported.inserted,3); assert.equal(db.list('plan').length,1);
    const repeat=timetableDraft(db,input); assert.equal(repeat.duplicates,3);
    assert.equal(importTimetable(db,{...input,digest:repeat.digest}).inserted,0);
    assert.equal(db.list('timetable').length,3);
    assert.equal(undoTimetable(db,imported.batchId!).removed,3);
    assert.equal(db.list('timetable').length,0); assert.equal(db.list('plan').length,1);
    assert.throws(()=>undoTimetable(db,imported.batchId!),/已撤销/);
  } finally { db.close(); }
});
test('database failure rolls back entire import; edited batches cannot be destructively undone',()=>{
  const db=store(); const input={rows:[row],term};
  try {
    db.db.exec("CREATE TRIGGER test_failure BEFORE INSERT ON records WHEN new.kind='timetable' AND json_extract(new.data,'$.date')='2026-11-09' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    assert.throws(()=>importTimetable(db,{...input,digest:timetableDraft(db,input).digest}),/injected/);
    assert.equal(db.list('timetable').length,0); assert.equal(db.list('timetableImport').length,0);
    db.db.exec('DROP TRIGGER test_failure');
    const imported=importTimetable(db,{...input,digest:timetableDraft(db,input).digest});
    const changed=db.list('timetable')[0]; db.put('timetable',{...changed,location:'新教室'});
    assert.throws(()=>undoTimetable(db,imported.batchId!),/已修改/);
    assert.equal(db.list('timetable').length,3); assert.equal(db.get(changed.id).location,'新教室');
    const snapshot=db.snapshot(); db.restore(snapshot);
    assert.equal(db.get(imported.batchId!).kind,'timetableImport');
  } finally { db.close(); }
});
test('invalid rows, unsafe expansion sizes and invalid course association cause no writes',()=>{
  const db=store();
  try {
    assert.throws(()=>timetableDraft(db,{rows:[row],term,courseId:'missing'}),/课程不存在/);
    assert.throws(()=>timetableDraft(db,{rows:[row,{...row,date:'2026-02-30'}],term}),/第 2 行/);
    assert.throws(()=>expandTimetable(Array.from({length:100},()=>({...row,weeks:'每周'})),{...term,weekCount:53}),/5000/);
    assert.equal(db.list('timetable').length,0);
  } finally { db.close(); }
});
