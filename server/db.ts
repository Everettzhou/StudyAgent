import {applyMemoryGuard} from "./personal-memory";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export class Store {
  db: DatabaseSync;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "study.sqlite"));
    this.db.exec(
      `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS by_kind ON records(kind);`,
    );
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS page_search USING fts5(id UNINDEXED,documentId UNINDEXED,text,tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS page_insert AFTER INSERT ON records WHEN new.kind='page' BEGIN INSERT INTO page_search VALUES(new.id,json_extract(new.data,'$.documentId'),json_extract(new.data,'$.text')); END;
      CREATE TRIGGER IF NOT EXISTS page_update AFTER UPDATE ON records WHEN new.kind='page' BEGIN DELETE FROM page_search WHERE id=old.id; INSERT INTO page_search VALUES(new.id,json_extract(new.data,'$.documentId'),json_extract(new.data,'$.text')); END;
      CREATE TRIGGER IF NOT EXISTS page_delete AFTER DELETE ON records WHEN old.kind='page' BEGIN DELETE FROM page_search WHERE id=old.id; END;
      INSERT INTO page_search SELECT id,json_extract(data,'$.documentId'),json_extract(data,'$.text') FROM records WHERE kind='page' AND id NOT IN (SELECT id FROM page_search);`);
    for (const j of this.list("job"))
      if (["running", "queued"].includes(j.status))
        this.put("job", {
          ...j,
          status: "paused",
          error: "上次运行中断，可重新运行；已完成页面保留。",
        });
  }
  list(kind: string): any[] {
    return (
      this.db
        .prepare("SELECT * FROM records WHERE kind=? ORDER BY updated DESC")
        .all(kind) as any[]
    ).map((x) => ({ ...JSON.parse(x.data), id: x.id, version: x.version }));
  }
  get(id: string): any {
    const r = this.db
      .prepare("SELECT * FROM records WHERE id=?")
      .get(id) as any;
    return r
      ? { ...JSON.parse(r.data), id: r.id, version: r.version, kind: r.kind }
      : null;
  }
  searchPages(documentIds:string[],query:string):any[]{
    if(!documentIds.length)return [];
    const words=(query.match(/[\u4e00-\u9fff]{2,4}|[a-zA-Z0-9]{2,}/g)||[]).slice(0,12);
    let hits:any[]=[];const searchable=words.filter(x=>x.length>=3);
    if(searchable.length){const match=searchable.map(w=>'"'+w.replace(/"/g,'""')+'"').join(' OR ');hits=this.db.prepare('SELECT id FROM page_search WHERE page_search MATCH ? ORDER BY rank LIMIT 200').all(match) as any[];}
    const all=this.list('page').filter(p=>documentIds.includes(p.documentId));
    return all.map(p=>({...p,score:(hits.findIndex(h=>h.id===p.id)>=0?100:0)+words.reduce((n,w)=>n+(p.text?.includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score||a.number-b.number).slice(0,18);
  }
  put(kind: string, data: any, expected?: number): any {
    const id = data.id || randomUUID(),
      old = this.get(id);
    if (old && old.kind !== kind) throw Error("记录类型不匹配");
    if (expected !== undefined && old?.version !== expected)
      throw Error("版本冲突，请刷新后重试");
    const { version, kind: _, ...payload } = data;
    const v = (old?.version || 0) + 1;
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated=excluded.updated",
      )
      .run(
        id,
        kind,
        JSON.stringify({ ...payload, id }),
        v,
        new Date().toISOString(),
      );
    return { ...payload, id, version: v };
  }
  del(id: string) {
    this.db.prepare("DELETE FROM records WHERE id=?").run(id);
  }
  setting(key: string, fallback: any = null) {
    const r = this.db
      .prepare("SELECT data FROM settings WHERE id=?")
      .get(key) as any;
    return r ? JSON.parse(r.data) : fallback;
  }
  set(key: string, data: any) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(key, JSON.stringify(data));
  }
  snapshot() {
    return {
      format: 1,
      at: new Date().toISOString(),
      records: this.db
        .prepare("SELECT * FROM records WHERE kind NOT IN ('device','job')")
        .all(),
      settings: this.db
        .prepare("SELECT * FROM settings WHERE id IN ('preferences','personalMemoryGuard')")
        .all(),
    };
  }
  restore(s: any) {
    if (
      s.format !== 1 ||
      !Array.isArray(s.records) ||
      s.records.length > 100000
    )
      throw Error("备份格式不正确");
    const allowed = new Set([
      "article","articlePage","researchSearch","thread","quickBatch","skill","skillRun","operation","trash","selfCheck",
      "course",
      "document",
      "page",
      "question",
      "attempt",
      "task",
      "plan",
      "memory",
      "review",
      "chat",
      "exam",
      "change",
      "timetable",
      "timetableImport",
      "partnerChat", "partnerImage", "personalMemory", "memorySummary", "memoryAction",
      "usage", "paperAsset", "paperSubmission", "masteryOverride", "masteryEvent",
    ]);
    for (const r of s.records) {
      if (
        !allowed.has(r.kind) ||
        typeof r.id !== "string" ||
        typeof r.data !== "string" ||
        !Number.isInteger(r.version)
      )
        throw Error("备份记录无效");
      JSON.parse(r.data);
    }
    const currentGuard=this.setting("personalMemoryGuard",{terms:[],sources:[],ids:[]});
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM records WHERE kind NOT IN ('device','job')");
      for (const r of s.records)
        this.db
          .prepare("INSERT INTO records VALUES(?,?,?,?,?)")
          .run(r.id, r.kind, r.data, r.version, r.updated);
      for (const r of s.settings || [])
        if (r.id === "preferences") this.set("preferences", JSON.parse(r.data));
      const imported=(s.settings||[]).find((r:any)=>r.id==='personalMemoryGuard');
      const guard=imported?JSON.parse(imported.data):{terms:[],sources:[],ids:[]};
      this.set('personalMemoryGuard',{terms:[...new Map([...currentGuard.terms,...guard.terms].map((t:any)=>[t.hash,t])).values()],sources:[...new Set([...currentGuard.sources,...guard.sources])],ids:[...new Set([...currentGuard.ids,...guard.ids])],privateSources:[...new Set([...(currentGuard.privateSources||[]),...(guard.privateSources||[])])]});
      applyMemoryGuard(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
