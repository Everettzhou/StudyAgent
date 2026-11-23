import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
const arr = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV 引号未闭合");
  row.push(cell.replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function sheetRows(bytes: Uint8Array, name: string): string[][] {
  if (/\.csv$/i.test(name))
    return parseCsv(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""));
  if (!/\.xlsx$/i.test(name)) throw Error("请使用 CSV 或 XLSX 文件");
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      size += f.originalSize;
      if (size > 40 * 1024 ** 2) throw Error("表格解压内容过大");
      return /^xl\/(sharedStrings.xml|worksheets\/sheet1.xml)$/.test(f.name);
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
  });
  const shared = files["xl/sharedStrings.xml"]
    ? arr(parser.parse(strFromU8(files["xl/sharedStrings.xml"])).sst.si).map(
        (si: any) =>
          si.t ??
          arr(si.r)
            .map((r: any) => r.t || "")
            .join(""),
      )
    : [];
  if (!files["xl/worksheets/sheet1.xml"]) throw Error("未发现首个工作表");
  const sheet = parser.parse(strFromU8(files["xl/worksheets/sheet1.xml"]));
  return arr(sheet.worksheet.sheetData.row).map((r: any) => {
    const row: string[] = [];
    for (const c of arr(r.c)) {
      const col = String(c["@_r"]).match(/^[A-Z]+/)?.[0] || "A";
      let index = 0;
      for (const ch of col) index = index * 26 + ch.charCodeAt(0) - 64;
      const value =
        c["@_t"] === "s"
          ? shared[Number(c.v)]
          : c["@_t"] === "inlineStr"
            ? c.is?.t
            : c.v;
      row[index - 1] = String(value ?? "");
    }
    return row;
  });
}
export function timetablePreview(rows: string[][]) {
  if (rows.length < 2) throw Error("表格需要表头与数据行");
  const aliases: any = {
    title: ["课程", "课程名称", "title"],
    date: ["日期", "date"],
    start: ["开始", "开始时间", "start"],
    end: ["结束", "结束时间", "end"],
    location: ["地点", "教室", "location"],
    weeks: ["周次", "weeks"],
    weekday: ["星期", "weekday"],
    periods: ["节次", "节数", "periods"],
  };
  const head = rows[0].map((s) => s.trim());
  const indexes = Object.fromEntries(
    Object.entries(aliases).map(([k, names]: any) => [
      k,
      head.findIndex((h) => names.includes(h)),
    ]),
  );
  if (indexes.title < 0) throw Error("缺少“课程”列，请使用模板表头");
  if (rows.slice(1).filter(r => r.some(Boolean)).length > 500)
    throw Error("课表一次最多 500 行，请分批导入");
  return rows
    .slice(1)
    .filter((r) => r.some(Boolean))
    .map((r) =>
      Object.fromEntries(
        Object.entries(indexes).map(([k, i]) => {
          let value = r[i as number] || "";
          if (k === "date" && /^\d{5}$/.test(value))
            value = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000)
              .toISOString()
              .slice(0, 10);
          if (["start", "end"].includes(k) && /^0\.\d+$/.test(value)) {
            const m = Math.round(Number(value) * 1440);
            value =
              String(Math.floor(m / 60)).padStart(2, "0") +
              ":" +
              String(m % 60).padStart(2, "0");
          }
          return [k, value];
        }),
      ),
    );
}
