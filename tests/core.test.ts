import test from "node:test";
import assert from "node:assert/strict";
import { mastery, schedule, nextBatch } from "../server/core";
import {parseCsv,timetablePreview} from '../server/sheets';
test("unconfirmed and prompted answers never count as independent mastery", () => {
  assert.equal(mastery([{ outcome: "prompted", confirmed: true }]), "待评估");
  assert.equal(mastery([{ outcome: "wrong", confirmed: false }]), "待评估");
});
test("confirmed wrong marks weak; three spaced novel independent answers demonstrate mastery", () => {
  assert.equal(mastery([{ outcome: "wrong", confirmed: true }]), "薄弱");
  assert.equal(
    mastery(
      [0, 2, 4].map((d) => ({
        outcome: "independent",
        confirmed: true,
        novel: true,
        at: `2026-10-${20 + d}`,
        questionId: `q${d}`,
      })),
    ),
    "较熟练",
  );
});
test("schedule respects fixed blocks, deadline, daily budget and leaves original intact", () => {
  const tasks = [
    {
      id: "a",
      title: "复习积分",
      minutes: 30,
      deadline: "2026-10-24",
      priority: 2,
    },
    { id: "b", title: "做题", minutes: 40, priority: 1 },
  ];
  const fixed = [{ start: "18:00", end: "18:30" }];
  const result = schedule(tasks, fixed, "2026-10-23", 18 * 60, 60);
  assert.equal(result.length, 1);
  assert.equal(result[0].start, "18:30");
  assert.equal(tasks[0].minutes, 30);
});
test("repeated original questions never establish novel mastery", () => {
  assert.equal(
    mastery(
      [0, 2, 4].map((d) => ({
        confirmed: true,
        outcome: "independent",
        novel: false,
        questionId: "same",
        at: `2026-10-${20 + d}`,
      })),
    ),
    "巩固中",
  );
});
test("two mistakes trigger explanation, limited time reduces batch", () => {
  assert.equal(
    nextBatch(
      [
        { confirmed: true, outcome: "wrong" },
        { confirmed: true, outcome: "wrong" },
      ],
      30,
    ).count,
    0,
  );
  assert.equal(nextBatch([], 15).count, 1);
  assert.equal(nextBatch([], 5).count, 0);
  assert.equal(nextBatch([], 60).count, 3);
});
test("invalid and expired tasks do not schedule", () => {
  assert.deepEqual(
    schedule(
      [
        { id: "a", minutes: NaN },
        { id: "b", minutes: 10, deadline: "2026-01-01" },
      ],
      [],
      "2026-10-23",
      1000,
      100,
    ),
    [],
  );
});
test('CSV quoted cells and Chinese timetable headers produce preview',()=>{const rows=parseCsv('课程,日期,开始,结束,地点\n"高等数学,上",2026-10-26,08:00,09:30,A101\n');assert.equal(rows[1][0],'高等数学,上');assert.equal(timetablePreview(rows)[0].start,'08:00');assert.throws(()=>parseCsv('"not closed'),/引号/);});
