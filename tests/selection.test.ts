import test from "node:test";
import assert from "node:assert/strict";
import {resolveSelection} from "../server/selection";
import {resolveConversation} from "../server/conversation";
import {overlaps,selectionRect,type SelectionSource} from "../shared/selection";
const records:Record<string,any>={
  d:{id:"d",kind:"document",name:"积分课件",courseId:"c"},
  p:{id:"p",kind:"page",documentId:"d",number:3,text:"课件第三页积分定义",version:2},
  q:{id:"q",kind:"question",courseId:"c",number:"7",stem:"求导",answer:"2x",explanation:"幂函数求导法则",topics:["导数"],version:1},
  r:{id:"r",kind:"review",courseId:"c",title:"复习提纲",text:"先复习积分",version:1},
  h:{id:"h",kind:"chat",courseId:"c",prompt:"为什么",text:"因为定义",version:1},
  e:{id:"e",kind:"exam",courseId:"c",mode:"exam",submitted:false,questionIds:["q"]},
};
const db={get:(id:string)=>records[id]};
const source=(id:string,kind:SelectionSource["kind"],version=1):SelectionSource=>({id,kind,version,courseId:"c"});
test("selection geometry normalizes reverse drag and excludes whitespace boundary",()=>{
  assert.deepEqual(selectionRect({x:10,y:20},{x:4,y:5}),{x:4,y:5,w:6,h:15});
  assert.equal(overlaps({x:0,y:0,w:10,h:10},{x:9,y:9,w:2,h:2}),true);
  assert.equal(overlaps({x:0,y:0,w:10,h:10},{x:10,y:0,w:2,h:2}),false);
});
test("page anchor reads exact page rather than search-only context",()=>{
  const r=resolveSelection(db,"c",source("p","page",2),"定义");
  assert.match(r.context,/积分课件 p\.3/);assert.match(r.context,/课件第三页/);assert.equal(r.anchor.source.version,2);
});
test("answer anchor retains problem, reference, steps and formula excerpt",()=>{
  const r=resolveSelection(db,"c",source("q","question"),String.raw`$\dfrac{1}{\sqrt{x+1}}$`);
  for(const s of ["题干：求导","参考答案：2x","解题步骤：幂函数求导法则","知识点：导数",String.raw`\dfrac{1}{\sqrt{x+1}}`])assert.ok(r.context.includes(s));
});
test("review and chat retain generation context and caveat",()=>{
  for(const [id,kind] of [["r","review"],["h","chat"]] as const){const r=resolveSelection(db,"c",source(id,kind),"定义");assert.match(r.context,/生成内容（可能有误，需核对）/);}
});
test("reject deleted, cross-course, spoofed kind and stale anchors",()=>{
  assert.throws(()=>resolveSelection(db,"c",source("gone","question"),"a"),/删除/);
  assert.throws(()=>resolveSelection(db,"other",source("q","question"),"a"),/课程/);
  assert.throws(()=>resolveSelection(db,"c",source("q","chat"),"a"),/删除/);
  assert.throws(()=>resolveSelection(db,"c",source("q","question",2),"a"),/更新/);
  assert.throws(()=>resolveSelection(db,"c",source("p","page",1),"a"),/更新/);
});
test("reject malformed, empty or excessive selections and invalid rectangle",()=>{
  for(const s of ["", " ", "x".repeat(6001),12])assert.throws(()=>resolveSelection(db,"c",source("q","question"),s),/字符/);
  assert.throws(()=>resolveSelection(db,"c",source("q","question"),"a",{x:NaN,y:0,w:1,h:1}),/坐标/);
});
test("exam answer context requires an available answer and matching question",()=>{
  assert.throws(()=>resolveSelection(db,"c",{...source("q","question"),examId:"e"},"2x"),/交卷/);
  const allowed={get:(id:string)=>id==="e"?{...records.e,submitted:true}:records[id]};
  assert.match(resolveSelection(allowed,"c",{...source("q","question"),examId:"e"},"2x").context,/参考答案/);
  assert.throws(()=>resolveSelection(db,"c",{...source("q","question"),examId:"missing"},"2x"),/来源/);
});
test("follow-up preserves server-owned original selection and chronological turns",()=>{
  const anchor={source:source("p","page",2),excerpt:"积分定义",imageHash:"a".repeat(64)};
  const messages:Record<string,any>={a:{id:"a",kind:"chat",courseId:"c",prompt:"为什么",text:"因为定义",selection:anchor},b:{id:"b",kind:"chat",courseId:"c",prompt:"举例",text:"举例说明",selection:anchor,parentChatId:"a",conversationId:"a"}};
  const result=resolveConversation({get:(id:string)=>messages[id]},"c","b");
  assert.equal(result.selection,anchor);assert.equal(result.conversationId,"a");assert.equal(result.parentId,"b");assert.equal(result.includedTurns,2);
  assert.ok(result.history.indexOf("为什么")<result.history.indexOf("举例"));
});
test("follow-up rejects cross-course and missing parents",()=>{
  assert.throws(()=>resolveConversation(db,"other","h"),/课程/);
  assert.throws(()=>resolveConversation(db,"c","missing"),/删除/);
  assert.throws(()=>resolveConversation(db,"c","q"),/课程/);
});
test("follow-up rejects damaged or cyclic chains",()=>{
  const chat={id:"a",kind:"chat",courseId:"c",prompt:"q",text:"a",parentChatId:"a"};
  assert.throws(()=>resolveConversation({get:()=>chat},"c","a"),/循环/);
  assert.throws(()=>resolveConversation({get:id=>id==="a"?{...chat,parentChatId:"missing"}:null},"c","a"),/删除/);
});
test("long dialogue bounds recent turns without forgetting the original selection",()=>{
  const messages=Array.from({length:12},(_,i)=>({id:String(i),kind:"chat",courseId:"c",prompt:"Q"+i,text:"A"+i,parentChatId:i?String(i-1):undefined,conversationId:"0",selection:{excerpt:"原选区"}}));
  const result=resolveConversation({get:id=>messages[Number(id)]},"c","11");
  assert.equal(result.includedTurns,8);assert.equal(result.omitted,true);assert.equal(result.selection.excerpt,"原选区");assert.ok(result.history.includes('Q11'));assert.ok(!result.history.includes('"Q0"'));
});
