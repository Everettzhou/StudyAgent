import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  statfsSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./db";
export function space(dir: string) {
  const s = statfsSync(dir);
  return {
    free: s.bavail * s.bsize,
    total: s.blocks * s.bsize,
    low: s.bavail * s.bsize < 5 * 1024 ** 3 || s.bavail / s.blocks < 0.1,
  };
}
export function saveFile(dir: string, base64: string) {
  const data = Buffer.from(base64, "base64");
  if (data.length > 30 * 1024 ** 2) throw Error("单文件上限 30 MB");
  const hash = createHash("sha256").update(data).digest("hex");
  mkdirSync(join(dir, "files"), { recursive: true });
  const path = join(dir, "files", hash);
  if (!existsSync(path)) writeFileSync(path, data);
  return { hash, size: data.length };
}
export function pptxText(data: Uint8Array) {
  const files = unzipSync(data, {
      filter: (f) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(f.name) &&
        f.originalSize < 2_000_000,
    }),
    parser = new XMLParser({ ignoreAttributes: false });
  const texts = (o: any): string[] => {
    if (!o || typeof o !== "object") return [];
    let out: string[] = [];
    for (const [k, v] of Object.entries(o)) {
      if (k === "a:t")
        out.push(
          typeof v === "object" ? String((v as any)["#text"] || "") : String(v),
        );
      else if (Array.isArray(v)) out.push(...v.flatMap(texts));
      else out.push(...texts(v));
    }
    return out;
  };
  return Object.keys(files)
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]),
    )
    .map((name, i) => ({
      number: i + 1,
      text: texts(parser.parse(strFromU8(files[name]))).join("\n"),
      note: "PPTX 文本提取；图片与版式请导出 PDF 后导入",
    }));
}
export function backup(db: Store) {
  const files: any = {
    "manifest.json": strToU8(JSON.stringify(db.snapshot())),
  };
  for (const name of readdirSync(join(db.dir, "files"))) {
    if (/^[a-f0-9]{64}$/.test(name))
      files["files/" + name] = new Uint8Array(
        readFileSync(join(db.dir, "files", name)),
      );
  }
  const data = zipSync(files, { level: 6 });
  const check = unzipSync(data);
  if (!check["manifest.json"]) throw Error("备份校验失败");
  const dir = join(db.dir, "backups");
  mkdirSync(dir, { recursive: true });
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
    temp = join(dir, name + ".tmp");
  writeFileSync(temp, data);
  renameSync(temp, join(dir, name));
  return name;
}
export function restoreBackup(db: Store, data: Buffer) {
  let size = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      size += f.originalSize;
      if (size > 500 * 1024 ** 2) throw Error("备份解压内容超过 500 MB");
      return f.name === "manifest.json" || /^files\/[a-f0-9]{64}$/.test(f.name);
    },
  });
  if (!files["manifest.json"]) throw Error("备份缺少清单");
  const snapshot = JSON.parse(strFromU8(files["manifest.json"]));
  for (const [name, value] of Object.entries(files)) {
    if (name === "manifest.json") continue;
    if (createHash("sha256").update(value).digest("hex") !== name.slice(6))
      throw Error("备份文件哈希不匹配");
  }
  for (const r of snapshot.records || []) {
    if (["document", "page"].includes(r.kind)) {
      const d = JSON.parse(r.data);
      for (const hash of [d.hash, d.imageHash].filter(Boolean))
        if (!/^[a-f0-9]{64}$/.test(hash) || !files["files/" + hash])
          throw Error("备份缺少引用资料");
    }
  }
  const before = backup(db);
  for (const [name, value] of Object.entries(files))
    if (name !== "manifest.json") writeFileSync(join(db.dir, name), value);
  db.restore(snapshot);
  return before;
}
