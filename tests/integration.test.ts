import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../server/app";
import { Store } from "../server/db";
import { publicGet } from "../server/net";
import { backup, restoreBackup, saveFile } from "../server/files";
import { unzipSync, strFromU8 } from "fflate";
test("SQLite versions, persistence, backup hash and credential exclusion", () => {
  const dir = mkdtempSync(join(tmpdir(), "study-db-"));
  mkdirSync(join(dir, "files"));
  const db = new Store(dir);
  const c = db.put("course", { name: "数学", cloud: true });
  assert.throws(() => db.put("course", { ...c, name: "覆盖" }, 0), /版本/);
  db.put("device", { tokenHash: "secret-device" });
  db.set("model", { apiKey: "must-not-export" });
  const f = saveFile(dir, Buffer.from("original document").toString("base64"));
  db.put("document", { courseId: c.id, ...f });
  const name = backup(db),
    zip = readFileSync(join(dir, "backups", name)),
    manifest = strFromU8(unzipSync(zip)["manifest.json"]);
  assert.ok(!manifest.includes("secret-device"));
  assert.ok(!manifest.includes("must-not-export"));
  db.del(c.id);
  restoreBackup(db, zip);
  assert.equal(db.get(c.id).name, "数学");
  assert.equal(
    readFileSync(join(dir, "files", f.hash), "utf8"),
    "original document",
  );
  db.close();
  const reopened = new Store(dir);
  assert.equal(reopened.get(c.id).name, "数学");
  reopened.close();
});
test("public website reader rejects private networks", async () => {
  await assert.rejects(() => publicGet("http://127.0.0.1/"), /公网/);
  await assert.rejects(() => publicGet("file:///etc/passwd"), /地址/);
});
test('FTS page index follows corrections and deletions without stale evidence',()=>{const dir=mkdtempSync(join(tmpdir(),'study-fts-'));const db=new Store(dir);const p=db.put('page',{documentId:'d',number:1,text:'integration by parts 分部积分'});assert.equal(db.searchPages(['d'],'integration')[0].score,101);db.put('page',{...p,text:'different topic 导数'});assert.equal(db.searchPages(['d'],'integration')[0].score,0);db.del(p.id);assert.equal(db.searchPages(['d'],'导数').length,0);db.close();});
test("HTTPS learning flow, CSRF, pairing, mock-model jobs, undo and consent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "study-api-")),
    web = join(dir, "web");
  mkdirSync(web);
  writeFileSync(join(web, "index.html"), "<html>test</html>");
  let saved: any = {};
  const modelInputs: any[] = [];
  const mock = http.createServer(async (req, res) => {
    let input = "";
    for await (const b of req) input += b;
    const d = JSON.parse(input);
    modelInputs.push(d);
    let content = "MOCK_OK";
    const prompt = d.messages?.at(-1)?.content;
    if (typeof prompt === "string" && prompt.includes("分析作答"))
      content = JSON.stringify({
        transcription: "2x",
        outcome: "correct",
        unclear: false,
        analysis: "测试桩：导数规则",
        affectedTopics: ["导数"],
      });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", () => r()));
  const app = await startApp({
    dir,
    webDir: web,
    port: 0,
    host: "127.0.0.1",
    test: true,
    secrets: {
      read: () => saved,
      write: (v) => {
        saved = v;
      },
    },
  });
  let cookie = "";
  async function call(
    path: string,
    data?: any,
    options: { cookie?: string; origin?: string } = {},
  ) {
    return new Promise<any>((resolve, reject) => {
      const serialized = data === undefined ? undefined : JSON.stringify(data);
      const request = https.request(
        app.url + "/api/" + path,
        {
          method: serialized ? "POST" : "GET",
          ca: app.tls.ca,
          headers: {
            ...(serialized
              ? {
                  "Content-Type": "application/json",
                  Origin: options.origin || app.url,
                }
              : {}),
            Cookie: options.cookie ?? cookie,
          },
        },
        (r) => {
          let text = "";
          r.on("data", (c) => (text += c));
          r.on("end", () =>
            resolve({
              status: r.statusCode,
              data: JSON.parse(text),
              cookie: r.headers["set-cookie"]?.[0]?.split(";")[0],
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(serialized);
    });
  }
  try {
    assert.equal((await call("state")).status, 401);
    const auth = await call("auth", { boot: app.boot });
    assert.equal(auth.status, 200);
    cookie = auth.cookie;
    assert.equal((await call("auth", { boot: app.boot })).status, 403);
    assert.equal(
      (
        await call(
          "save",
          { kind: "course", data: { name: "CSRF", cloud: false } },
          { origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    const c = (
      await call("save", {
        kind: "course",
        data: { name: "高等数学", cloud: false },
      })
    ).data;
    assert.ok(c.id);
    const blocked = (
      await call("job", { action: "ask", courseId: c.id, prompt: "问题" })
    ).data;
    await new Promise((r) => setTimeout(r, 100));
    assert.match(app.db.get(blocked.id).error, /云端/);
    await call("save", {
      kind: "course",
      data: { ...c, cloud: true },
      version: c.version,
    });
    await call("settings", {
      model: {
        baseUrl: `http://127.0.0.1:${(mock.address() as any).port}/v1`,
        model: "test",
        inputPrice: "",
        outputPrice: "",
      },
      apiKey: "MOCK_NOT_REAL",
    });
    const q = (
      await call("question", {
        courseId: c.id,
        stem: "求 x² 的导数",
        topics: ["导数"],
        answer: "2x",
        number: "1",
        wrong: true,
      })
    ).data;
    assert.ok(q.id);
    const anchored = (await call("job",{action:"ask",courseId:c.id,prompt:"解释这个式子",selection:"2x",selectionSource:{kind:"question",id:q.id,version:q.version,courseId:c.id}})).data;
    for(let n=0;n<60&&["queued","running"].includes(app.db.get(anchored.id).status);n++)await new Promise(r=>setTimeout(r,30));
    assert.equal(app.db.get(anchored.id).status,"done");
    assert.ok(JSON.stringify(modelInputs.at(-1)).includes("参考答案：2x"));
    assert.ok(JSON.stringify(modelInputs.at(-1)).includes("题干：求 x² 的导数"));
    const chat=app.db.list("chat")[0];assert.equal(chat.selection.source.id,q.id);assert.equal(chat.selection.excerpt,"2x");

    const follow=(await call("job",{action:"ask",courseId:c.id,prompt:"能再举一个例子吗",parentChatId:chat.id})).data;
    for(let n=0;n<60&&["queued","running"].includes(app.db.get(follow.id).status);n++)await new Promise(r=>setTimeout(r,30));
    assert.equal(app.db.get(follow.id).status,"done");
    const lastInput=JSON.stringify(modelInputs.at(-1));for(const term of ["连续追问","解释这个式子","MOCK_OK","能再举一个例子吗","参考答案：2x"])assert.ok(lastInput.includes(term));
    const nextChat=app.db.list("chat").find(x=>x.jobId===follow.id);assert.equal(nextChat.parentChatId,chat.id);assert.equal(nextChat.conversationId,chat.id);assert.equal(nextChat.selection.source.id,q.id);
    const callsBefore=modelInputs.length;
    const stale=(await call("job",{action:"ask",courseId:c.id,prompt:"旧选区",selection:"2x",selectionSource:{kind:"question",id:q.id,version:0,courseId:c.id}})).data;
    for(let n=0;n<60&&["queued","running"].includes(app.db.get(stale.id).status);n++)await new Promise(r=>setTimeout(r,30));
    assert.equal(app.db.get(stale.id).status,"failed");assert.match(app.db.get(stale.id).error,/更新/);assert.equal(modelInputs.length,callsBefore);

    const j = (
      await call("job", {
        action: "grade",
        courseId: c.id,
        questionId: q.id,
        answer: "2x",
      })
    ).data;
    for (let n = 0; n < 30 && app.db.get(j.id).status !== "done"; n++)
      await new Promise((r) => setTimeout(r, 30));
    assert.equal(app.db.get(j.id).status, "done");
    assert.equal(app.db.get(q.id).grading.confirmed, false);
    const a = await call("attempt", {
      id: "attempt-once",
      questionId: q.id,
      outcome: "wrong",
      answer: "x",
    });
    assert.equal(a.status, 200);
    await call("attempt", {
      id: "attempt-once",
      questionId: q.id,
      outcome: "wrong",
    });
    assert.equal(app.db.list("attempt").length, 1);
    assert.equal(app.db.list("memory").length, 1);
    assert.equal(app.db.list("task").length, 1);
    const state = (await call("state")).data;
    assert.equal(state.mastery[c.id + "|导数"], "薄弱");
    assert.ok(!JSON.stringify(state).includes("MOCK_NOT_REAL"));
    assert.equal(state.records.usage[0].cost, null);
    await call("settings", { preferences: { start: "18:00", minutes: 30 } });
    await call("save", {
      kind: "timetable",
      data: { title: "上课", date: "2026-10-23", start: "18:00", end: "19:00" },
    });
    const plansBefore=app.db.list('plan').map(p=>p.id).sort();
    const plan = (await call("plan", { date: "2026-10-23" })).data;
    assert.equal(plan.plans[0].start, "19:00");
    const change = app.db.list("change")[0];
    await call("undo", { id: change.id });
    assert.deepEqual(app.db.list("plan").map(p=>p.id).sort(), plansBefore);
    const deviceInfo = (await call("devices")).data;
    const p = (
      await call(
        "pair",
        { code: deviceInfo.code, name: "Test phone" },
        { cookie: "" },
      )
    ).data;
    await call("device-action", { action: "approve", id: p.id });
    const approved = await call("pair/status", { id: p.id }, { cookie: "" });
    assert.ok(approved.cookie);
    assert.equal(
      (await call("state", undefined, { cookie: approved.cookie })).status,
      200,
    );
    assert.equal(
      (await call("devices", undefined, { cookie: approved.cookie })).status,
      400,
    );
    const dev = app.db.list("device")[0];
    await call("device-action", { action: "revoke", id: dev.id });
    assert.equal(
      (await call("state", undefined, { cookie: approved.cookie })).status,
      401,
    );
    const del = await call("delete", { id: app.db.list("memory")[0].id });
    assert.equal(del.status, 200);
    assert.equal(app.db.list("memory").length, 0);
  } finally {
    await app.close();
    await new Promise<void>((r) => mock.close(() => r()));
  }
});
