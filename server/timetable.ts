// Calendar arithmetic uses UTC date-only values: DST never shifts an occurrence.
export type Term = {
  weekOneMonday?: string;
  weekCount?: number;
  periods?: { number: number; start: string; end: string }[];
  skipDates?: string[];
};
export type Occurrence = {
  title: string; date: string; start: string; end: string; location: string;
  courseId: string; sourceRow: number; week?: number; weeks: string;
};
const DAY = 86400000;
const string = (v: unknown) => v == null ? "" : String(v).trim();
export function dateOnly(value: unknown): number {
  const s = string(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error("日期应为 YYYY-MM-DD");
  const time = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== s)
    throw Error("日期不存在");
  return time;
}
function timeRange(start: string, end: string) {
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(start) || !valid.test(end) || end <= start)
    throw Error("起止时间应为 HH:mm，结束时间须晚于开始时间");
}
export function weekdayNumber(value: unknown): number {
  const s = string(value).replace(/^(星期|周|礼拜)/, "");
  const n = /^[1-7]$/.test(s) ? Number(s) : /^[一二三四五六日天]$/.test(s) ? "一二三四五六日".indexOf(s === "天" ? "日" : s) + 1 : 0;
  if (!s || n < 1 || n > 7) throw Error("星期应为周一至周日或数字 1–7");
  return n;
}
export function parseWeeks(value: unknown, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 53)
    throw Error("学期周数应为 1–53");
  let s = string(value).replace(/\s+/g, "").replace(/[，、；;]/g, ",")
    .replace(/[~～—–至]/g, "-").replace(/（/g, "(").replace(/）/g, ")");
  if (!s) throw Error("请填写周次；全部周次可填“每周”");
  const all = () => Array.from({ length: count }, (_, i) => i + 1);
  if (["每周", "全周", "全部"].includes(s)) return all();
  if (/^(单|双)周$/.test(s)) return all().filter(n => n % 2 === (s[0] === "单" ? 1 : 0));
  const result = new Set<number>();
  // A trailing parity applies to the whole expression: 1-8,10-16(单).
  const global = s.match(/^(.*)\((单|双)(?:周)?\)$/);
  let globalParity: string | undefined;
  if (global && !/[()]/.test(global[1])) { s = global[1]; globalParity = global[2]; }
  for (const part of s.split(",")) {
    const m = part.match(/^(?:第)?(\d+)(?:-(\d+))?(?:周)?(?:\(?(单|双)(?:周)?\)?)?$/);
    if (!m) throw Error(`周次“${part}”格式不明确，请用 1-16、1-16(单) 或 1,3,5`);
    const a = Number(m[1]), b = Number(m[2] || m[1]), parity = m[3] || globalParity;
    if (a < 1 || b < a || b > count) throw Error(`周次须在 1–${count} 内且范围递增`);
    for (let n = a; n <= b; n++)
      if (!parity || n % 2 === (parity === "单" ? 1 : 0)) result.add(n);
  }
  if (!result.size) throw Error("周次筛选后没有上课周，请核对单双周");
  return [...result].sort((a, b) => a - b);
}
function periodRange(value: unknown, periods: Term["periods"]): [string, string] {
  const s = string(value).replace(/\s+/g, "").replace(/[~～—–至]/g, "-");
  const m = s.match(/^(?:第)?(\d+)(?:-(\d+))?(?:节)?$/);
  if (!m) throw Error("缺少时间；节次请填连续范围，如 1-2 或第3节");
  const a = Number(m[1]), b = Number(m[2] || m[1]);
  if (a < 1 || b < a || b > 30) throw Error("节次范围应在 1–30 内且递增");
  if (!Array.isArray(periods) || periods.length > 30) throw Error("请先配置学校节次时间");
  const selected = [];
  for (let n = a; n <= b; n++) {
    const matches = periods.filter(p => p.number === n);
    if (matches.length !== 1) throw Error(`第 ${n} 节需要唯一的起止时间`);
    const p = matches[0]; timeRange(p.start, p.end);
    if (selected.length && selected.at(-1)!.end > p.start) throw Error("节次时间重叠或顺序不正确");
    selected.push(p);
  }
  return [selected[0].start, selected.at(-1)!.end];
}
export function expandTimetable(rows: any[], term: Term = {}, courseId = ""): { items: Occurrence[]; excluded: number } {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw Error("课表需包含 1–500 行");
  if (!term || typeof term !== "object") throw Error("学期设置格式不正确");
  if (term.skipDates !== undefined && (!Array.isArray(term.skipDates) || term.skipDates.length > 366))
    throw Error("停课日期最多 366 项");
  const skip = new Set((term.skipDates || []).map(d => { dateOnly(d); return d; }));
  const items: Occurrence[] = []; let excluded = 0;
  rows.forEach((row, index) => {
    try {
      if (!row || typeof row !== "object") throw Error("课程行格式不正确");
      const title = string(row.title), location = string(row.location);
      if (!title || title.length > 200 || location.length > 200) throw Error("课程名必填；课程名与地点最多 200 字");
      let start = string(row.start), end = string(row.end);
      if (start || end) timeRange(start, end);
      else [start, end] = periodRange(row.periods, term.periods);
      const dates: { date: string; week?: number }[] = [];
      if (string(row.date)) {
        dateOnly(row.date); dates.push({ date: string(row.date) });
      } else {
        const monday = dateOnly(term.weekOneMonday);
        if (new Date(monday).getUTCDay() !== 1) throw Error("第 1 周起始日期必须为星期一");
        const weekday = weekdayNumber(row.weekday);
        for (const week of parseWeeks(row.weeks, Number(term.weekCount))) {
          const date = new Date(monday + ((week - 1) * 7 + weekday - 1) * DAY).toISOString().slice(0, 10);
          dates.push({ date, week });
        }
      }
      for (const d of dates) {
        if (skip.has(d.date)) { excluded++; continue; }
        items.push({ title, ...d, start, end, location, courseId, sourceRow: index + 1, weeks: string(row.weeks) });
        if (items.length > 5000) throw Error("一次展开最多 5000 次课程，请分批导入");
      }
    } catch (e) { throw Error(`第 ${index + 1} 行：${(e as Error).message}`); }
  });
  return { items: items.sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.sourceRow-b.sourceRow), excluded };
}
export const occurrenceKey = (p: any) => JSON.stringify([p.title, p.date, p.start, p.end, p.location || ""]);
export function previewTimetable(rows: any[], term: Term, courseId: string, existing: any[], plans: any[]) {
  const expanded = expandTimetable(rows, term, courseId);
  const keys = new Set(existing.map(occurrenceKey)), items: Occurrence[] = [];
  let duplicates = 0;
  for (const item of expanded.items) {
    const key = occurrenceKey(item);
    if (keys.has(key)) { duplicates++; continue; }
    keys.add(key); items.push(item);
  }
  const byDate = new Map<string, any[]>();
  for (const p of [...existing, ...plans]) {
    if (["done", "skip"].includes(p.status)) continue;
    const group = byDate.get(p.date) || []; group.push(p); byDate.set(p.date, group);
  }
  const conflicts: { date: string; title: string; start: string; end: string; otherTitle: string; otherStart: string; otherEnd: string }[] = [];
  let conflictCount = 0;
  for (const item of items) {
    const group = byDate.get(item.date) || [];
    for (const other of group) if (item.start < other.end && other.start < item.end) {
      conflictCount++;
      if (conflicts.length < 100) conflicts.push({ date: item.date, title: item.title, start: item.start, end: item.end,
        otherTitle: other.title || "已有安排", otherStart: other.start, otherEnd: other.end });
    }
    group.push(item); byDate.set(item.date, group);
  }
  return { ...expanded, items, duplicates, conflicts, conflictCount };
}
