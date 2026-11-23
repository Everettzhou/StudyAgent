import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Store} from "../server/db";
import {dueItems,localDay,reminderRunner} from "../server/reminders";
function fixture(){const db=new Store(mkdtempSync(join(tmpdir(),"study-reminder-")));db.put("course",{id:"c",name:"数学"});db.set("preferences",{start:"18:00",notify:true});return db;}
const now=new Date(2026,9,25,18,30);
test("due plans include today's started and overdue items, not future/completed/skipped",()=>{
 const db=fixture();try{for(const [id,date,start,status] of [["due","2026-10-25","18:00","todo"],["overdue","2026-10-24","23:00","partial"],["future","2026-10-25","19:00","todo"],["tomorrow","2026-10-26","00:00","todo"],["done","2026-10-25","18:00","done"],["skip","2026-10-25","18:00","skip"]])db.put("plan",{id,date,start,status,title:id,courseId:"c"});assert.deepEqual(dueItems(db,now).map(i=>i.title),["overdue","due"]);}finally{db.close();}
});
test("unplanned tasks and wrong questions wait for daily start and preserve deep links",()=>{
 const db=fixture();try{db.put("task",{id:"t",title:"复习笔记",status:"todo",courseId:"c"});db.put("question",{id:"q",courseId:"c",number:"3",topics:["导数"],wrong:true});assert.equal(dueItems(db,new Date(2026,9,25,17,59)).length,0);const items=dueItems(db,now);assert.equal(items.length,2);assert.equal(items.find(i=>i.key==="question:q")?.target.id,"q");assert.equal(items.find(i=>i.key.startsWith("task:"))?.target.tab,"plan");}finally{db.close();}
});
test("future scheduled task does not produce an early duplicate or wrong-question fallback",()=>{
 const db=fixture();try{db.put("question",{id:"q",courseId:"c",wrong:true});db.put("task",{id:"t",courseId:"c",questionId:"q",status:"todo",title:"复习"});db.put("plan",{taskId:"t",date:"2026-10-26",start:"18:00",status:"todo",title:"复习"});assert.equal(dueItems(db,now).length,0);}finally{db.close();}
});
test("completed tasks, removed parents and resolved independent answers stop reminders",()=>{
 const db=fixture();try{db.put("task",{id:"t",status:"done",questionId:"q",courseId:"c"});db.put("question",{id:"q",wrong:true,courseId:"c"});db.put("plan",{taskId:"t",date:"2026-10-25",start:"18:00",status:"todo"});db.put("plan",{taskId:"missing",date:"2026-10-25",start:"18:00",status:"todo"});db.put("question",{id:"resolved",courseId:"c",wrong:true});db.put("attempt",{questionId:"resolved",confirmed:true,outcome:"independent",at:now.toISOString()});assert.equal(dueItems(db,now).length,0);}finally{db.close();}
});
test("malformed dates and times, deleted courses and deleted questions never fire",()=>{
 const db=fixture();try{for(const [date,start] of [["2026-02-30","18:00"],["2026-10-25","25:00"],["garbage","00:00"]])db.put("plan",{date,start,status:"todo"});db.put("task",{title:"orphan",questionId:"gone",courseId:"c"});db.put("question",{wrong:true,courseId:"deleted"});assert.equal(dueItems(db,now).length,0);}finally{db.close();}
});
test("successful delivery aggregates and persists once per day across restart",async()=>{
 let db=fixture();const dir=db.dir;try{db.put("task",{id:"t",title:"复习",status:"todo"});let calls=0;const run=reminderRunner(db,async items=>{calls++;assert.equal(items.length,1);return true;});assert.equal(await run(now),1);assert.equal(await run(now),0);db.close();db=new Store(dir);const resumed=reminderRunner(db,async()=>{calls++;return true;});assert.equal(await resumed(now),0);assert.equal(await resumed(new Date(2026,9,26,18,30)),1);assert.equal(calls,2);}finally{db.close();}
});
test("disabled notifications keep the due inbox without consuming notification state",async()=>{
 const db=fixture();try{db.put("task",{title:"复习"});db.set("preferences",{notify:false,start:"18:00"});let calls=0;const run=reminderRunner(db,async()=>{calls++;return true;});assert.equal(await run(now),0);assert.equal(calls,0);assert.equal(dueItems(db,now).length,1);assert.equal(db.setting("reminderLedger"),null);}finally{db.close();}
});
test("failed notifications can retry, concurrent ticks do not duplicate deliveries",async()=>{
 const db=fixture();try{db.put("task",{title:"复习"});const failed=reminderRunner(db,async()=>false);assert.equal(await failed(now),0);assert.equal(db.setting("reminderLedger"),null);let finish!:(v:boolean)=>void;const run=reminderRunner(db,()=>new Promise(r=>finish=r));const first=run(now);assert.equal(await run(now),0);finish(true);assert.equal(await first,1);assert.equal(await run(now),0);}finally{db.close();}
});
test("rescheduling changes the reminder occurrence without mutating the task",async()=>{
 const db=fixture();try{const p=db.put("plan",{id:"p",date:"2026-10-25",start:"18:00",status:"todo",title:"复习"});const run=reminderRunner(db,async()=>true);assert.equal(await run(now),1);db.put("plan",{...p,start:"18:20"});assert.equal(await run(now),1);assert.equal(db.get("p").status,"todo");assert.equal(localDay(now),"2026-10-25");}finally{db.close();}
});
