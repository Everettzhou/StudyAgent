import { createHash, randomUUID } from "node:crypto";
import { Store } from "./db";
import { previewTimetable } from "./timetable";

export function timetableDraft(db: Store, input: any) {
  const courseId = typeof input.courseId === "string" ? input.courseId : "";
  if (courseId && db.get(courseId)?.kind !== "course") throw Error("课程不存在，请重新选择");
  const existing = db.list("timetable"), plans = db.list("plan");
  const result = previewTimetable(input.rows, input.term || {}, courseId, existing, plans);
  // Bind confirmation to both the displayed result and current relevant records.
  const revision = [...existing, ...plans].map(p => [p.id, p.version]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
  const digest = createHash("sha256").update(JSON.stringify({ result, revision })).digest("hex");
  return { ...result, digest };
}
export function importTimetable(db: Store, input: any) {
  db.db.exec("BEGIN IMMEDIATE");
  try {
    const draft = timetableDraft(db, input);
    if (input.digest !== draft.digest) throw Error("预览已变更或已有安排发生变化，请重新展开预览");
    if (draft.conflictCount && input.acceptConflicts !== true) throw Error("存在时间冲突，请核对并明确确认后再导入");
    if (!draft.items.length) { db.db.exec("COMMIT"); return { inserted: 0, duplicates: draft.duplicates, batchId: null }; }
    const batchId = randomUUID();
    const records = draft.items.map(item => db.put("timetable", { ...item, importBatchId: batchId }));
    db.put("timetableImport", { id: batchId, at: new Date().toISOString(), count: records.length,
      records: records.map(r => ({ id: r.id, version: r.version })), undone: false });
    db.db.exec("COMMIT");
    return { inserted: records.length, duplicates: draft.duplicates, batchId };
  } catch (e) { db.db.exec("ROLLBACK"); throw e; }
}
export function undoTimetable(db: Store, id: string) {
  db.db.exec("BEGIN IMMEDIATE");
  try {
    const batch = db.get(id);
    if (batch?.kind !== "timetableImport" || batch.undone) throw Error("导入批次不存在或已撤销");
    for (const record of batch.records) {
      const current = db.get(record.id);
      if (!current || current.kind !== "timetable" || current.importBatchId !== id || current.version !== record.version)
        throw Error("此批次有课程已修改或删除，请逐项处理，避免覆盖后续修改");
    }
    for (const record of batch.records) db.del(record.id);
    db.put("timetableImport", { ...batch, undone: true });
    db.db.exec("COMMIT");
    return { removed: batch.records.length };
  } catch (e) { db.db.exec("ROLLBACK"); throw e; }
}
