import {UploadButton} from "./UploadButton";
import { useState } from "react";
type Item = Record<string, any>;
async function api(path: string, body: any) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw Error(data.error || '请求失败'); return data;
}
const base64 = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
});
export function TimetableImport({ course, job, run, jobs, batches }: {
  course: string; job: any; run: any; jobs: Item[]; batches: Item[];
}) {
  const [url, setUrl] = useState(''), [text, setText] = useState(''), [image, setImage] = useState('');
  const [rows, setRows] = useState<Item[]>([]), [monday, setMonday] = useState(''), [weekCount, setWeekCount] = useState('16');
  const [periodText, setPeriodText] = useState(''), [skipText, setSkipText] = useState('');
  const [result, setResult] = useState<Item | null>(null), [accepted, setAccepted] = useState(false), [working, setWorking] = useState(false), [page, setPage] = useState(0);
  const inputKey = JSON.stringify({ rows, monday, weekCount, periodText, skipText, course });
  const draft = result?.inputKey === inputKey ? result : null;
  const input = () => ({ rows, courseId: course, term: {
    weekOneMonday: monday, weekCount: Number(weekCount),
    skipDates: skipText.trim() ? skipText.trim().split(/[\s,，;；]+/) : [],
    periods: periodText.split('\n').filter(s => s.trim()).map((line, i) => {
      const fields = line.trim().split(/[,，\s]+/);
      if (fields.length !== 3 || !/^\d+$/.test(fields[0])) throw Error(`节次时间第 ${i + 1} 行请填写：节次,开始,结束`);
      return { number: Number(fields[0]), start: fields[1], end: fields[2] };
    }),
  } });
  const load = (value: Item[]) => { setRows(value); setResult(null); setAccepted(false); setPage(0); };
  const fields = [ ['title', '课程'], ['date', '具体日期（单次）'], ['weekday', '星期（1–7）'], ['weeks', '周次'],
    ['start', '开始时间'], ['end', '结束时间'], ['periods', '节次（可选）'], ['location', '地点'] ];
  return <div className="timetable-import" data-testid="timetable-import">
    <h4>1 · 获取或录入课表</h4>
    <p className="muted">支持单次日期与学期周次混合导入。填了具体日期的行只生成一次；填了起止时间时优先使用时间，否则按学校节次表换算。</p>
    <div className="toolbar">
      <UploadButton className="secondary">导入 CSV / Excel<input hidden type="file" accept=".csv,.xlsx" aria-label="课表文件" onChange={e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) void run(async () => { const r = await api('sheet', { name: f.name, base64: (await base64(f)).split(',')[1] }); load(r.preview); });
      }} /></UploadButton>
      <button className="ghost" onClick={() => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF课程,日期,星期,周次,开始,结束,节次,地点\n高等数学,,周一,1-16(单),08:00,09:30,,A101\n'], { type: 'text/csv;charset=utf-8' }));
        a.download = '课表导入模板.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }}>下载课表模板</button>
      <button className="secondary" disabled={rows.length >= 500} onClick={() => load([...rows, { title: '', weekday: '1', weeks: '每周' }])}>添加周期课程</button>
    </div>
    <details className="timetable-source"><summary>从官网、文本或截图提取</summary>
      <div className="toolbar"><input aria-label="教务官网地址" value={url} onChange={e => setUrl(e.target.value)} placeholder="与助手确认的教务官网 HTTPS 网址" />
        <button className="secondary" onClick={() => void run(() => api('browser', { url }), '官网登录窗口已打开；请自行登录并进入课表页面')}>打开官网</button>
        <button className="secondary" onClick={() => void job('timetable', { website: true })}>读取已登录页面</button></div>
      <textarea aria-label="课表文本" value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="粘贴课表文本；提取后可修正星期、周次与节次。" />
      <div className="toolbar"><UploadButton className="secondary">上传课表截图<input hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) void base64(f).then(setImage); }} /></UploadButton>
        <button className="secondary" onClick={() => void job('timetable', { text, image: image || undefined })}>提取预览</button>
        <button className="ghost" onClick={() => { const j = jobs.find(j => j.action === 'timetable' && j.status === 'done'); if (j?.result?.preview) load(j.result.preview); }}>载入最新预览</button>
      </div>
    </details>
    {rows.map((row, index) => <fieldset className="timetable-row" key={index}>
      <legend>第 {index + 1} 行</legend><div className="form-grid timetable-fields">
        {fields.map(([key, label]) => <label key={key}>{label}<input aria-label={`第${index + 1}行${label}`} value={row[key] ?? ''}
          type={key === 'date' ? 'date' : ['start', 'end'].includes(key) ? 'time' : 'text'}
          placeholder={key === 'weeks' ? '1-16(单) 或 1,3,5' : key === 'periods' ? '1-2' : ''}
          onChange={e => setRows(current => current.map((r, i) => i === index ? { ...r, [key]: e.target.value } : r))} /></label>)}
      </div><button className="ghost" aria-label={`移除第${index + 1}行`} onClick={() => load(rows.filter((_, i) => i !== index))}>移除此行</button>
    </fieldset>)}
    {rows.length > 0 && <>
      <h4>2 · 设置学期与停课日期</h4>
      <div className="form-grid timetable-fields">
        <label>第 1 周的星期一<input type="date" aria-label="第1周星期一" value={monday} onChange={e => setMonday(e.target.value)} /></label>
        <label>学期周数<input type="number" min="1" max="53" aria-label="学期周数" value={weekCount} onChange={e => setWeekCount(e.target.value)} /></label>
      </div>
      <p className="muted">单双周按教学周编号计算，不按日历周计算。未填具体日期的行必须提供周次和星期；没有默认假期。</p>
      <div className="two-col">
        <label>学校节次时间（仅按节次导入时填写）<textarea rows={4} aria-label="学校节次时间" value={periodText} onChange={e => setPeriodText(e.target.value)} placeholder={'每行：节次,开始,结束\n1,08:00,08:45\n2,08:55,09:40'} /></label>
        <label>停课日期（可选，逗号或换行分隔）<textarea rows={4} aria-label="停课日期" value={skipText} onChange={e => setSkipText(e.target.value)} placeholder={'YYYY-MM-DD\n适用于本次导入的所有课程'} /></label>
      </div>
      <button disabled={working} onClick={() => void run(async () => {
        setWorking(true); setResult(null); setAccepted(false);
        try { const r = await api('timetable/preview', input()); setResult({ ...r, inputKey }); setPage(0); } finally { setWorking(false); }
      })}>展开并检查课表</button>
      {result && !draft && <p role="status">输入已变更，请重新展开预览。</p>}
    </>}
    {draft && <section className="timetable-preview" aria-label="具体课表预览">
      <h4>3 · 核对具体日期后确认</h4>
      <p role="status">待导入 {draft.items.length} 次课程 · 跳过重复 {draft.duplicates} 次 · 停课排除 {draft.excluded} 次 · 时间冲突 {draft.conflictCount} 处</p>
      {draft.conflictCount > 0 && <div className="timetable-conflicts">
        <strong>以下安排重叠；现有课表与学习计划保持不变。</strong>
        <ul>{draft.conflicts.map((c: Item, i: number) => <li key={i}>{c.date}：{c.title} {c.start}–{c.end} 与 {c.otherTitle} {c.otherStart}–{c.otherEnd}</li>)}</ul>
        {draft.conflictCount > 100 && <p>仅显示前 100 处冲突，共 {draft.conflictCount} 处，请分批核对。</p>}
        <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我已核对冲突，仍要导入（不覆盖已有安排）</label>
      </div>}
      <div className="timetable-table"><table><thead><tr><th>日期</th><th>教学周</th><th>课程</th><th>时间</th><th>地点</th><th>来源行</th></tr></thead><tbody>
        {draft.items.slice(page * 50, (page + 1) * 50).map((p: Item, i: number) => <tr key={i}><td>{p.date}</td><td>{p.week ? `第 ${p.week} 周` : '单次'}</td><td>{p.title}</td><td>{p.start}–{p.end}</td><td>{p.location || '—'}</td><td>{p.sourceRow}</td></tr>)}
      </tbody></table></div>
      {draft.items.length > 50 && <div className="toolbar"><button className="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(draft.items.length / 50)} 页</span><button className="ghost" disabled={(page + 1) * 50 >= draft.items.length} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
      <button disabled={working || !draft.items.length || (draft.conflictCount > 0 && !accepted)} onClick={() => void run(async () => {
        setWorking(true);
        try { await api('timetable/import', { ...input(), digest: draft.digest, acceptConflicts: accepted }); load([]); } finally { setWorking(false); }
      }, '课表已确认导入；可在下方撤销本次导入')}>确认导入 {draft.items.length} 次课程</button>
    </section>}
    {batches.length > 0 && <section className="timetable-history"><h4>最近导入批次</h4>
      {batches.slice(0, 5).map(batch => <div className="toolbar" key={batch.id}><span>{new Date(batch.at).toLocaleString()} · {batch.count} 次课程{batch.undone ? ' · 已撤销' : ''}</span>
        {!batch.undone && <button className="ghost" disabled={working} onClick={() => void run(async () => { setWorking(true); try { await api('timetable/undo', { id: batch.id }); setResult(null); } finally { setWorking(false); } }, '本次课表导入已撤销')}>撤销本次导入</button>}</div>)}
      <p className="muted">批次中任一课程被修改或删除后，整批撤销将停止，保留后续修改。</p>
    </section>}
  </div>;
}
