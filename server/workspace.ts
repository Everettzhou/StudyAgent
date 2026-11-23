import {readingProgress} from './reading';
import type {Store} from './db';
import type {AI} from './ai';
import {jsonResult} from './ai';
import {generateQuick,quickAnswer,quickPlan,selfCheck} from './quick-practice';
import {searchResearch,collectArticle,importArticle,downloadArticle,importArticleUrl,saveArticlePage} from './research';
import {importSkill,runSkill} from './skills';
import {createThread,answerThread} from './threads';
import {applyChanges,undoChanges} from './agent-workspace';
import {syncLearning} from './learning';
export const workspaceKinds=['article','articlePage','researchSearch','thread','quickBatch','skill','skillRun','operation','trash','selfCheck'];
export const workspaceActions=['quick-generate','research-search','research-download','research-import-url','thread-chat','skill-run','smart-practice','self-check'];
export function workspace(db:Store,ai:AI,record:(q:any,a:any)=>any,reconcile:()=>void){
 return {
 async action(action:string,b:any,signal:AbortSignal,jobId:string,invoke:(a:string,b:any)=>Promise<any>):Promise<any>{
  if(action==='quick-generate')return generateQuick(db,b,s=>ai.call(s,[],signal),signal);
  if(action==='research-search')return searchResearch(db,b);
  if(action==='research-download')return downloadArticle(db,b);
  if(action==='research-import-url')return importArticleUrl(db,b);
  if(action==='self-check'){const r=selfCheck(db,b,record);reconcile();return r;}
  if(action==='skill-run')return runSkill(db,b,signal);
  if(action==='thread-chat')return answerThread(db,ai,b,signal,jobId,invoke);
  if(action==='smart-practice'){
   const p=quickPlan(db,b);if(db.get(p.courseId)?.cloud!==true)throw Error('当前课程未开启模型连接');
   const defaults=jsonResult(await ai.call('SMART_SETTINGS\n根据学习记录补全练习设置，只返回 JSON {topics:["具体知识点"],practiceRequest:"明确的解题题型要求"}。不得替换用户已填写项；记忆不足时用当前课程基础诊断。'+JSON.stringify({plan:p,request:b}),[],signal));
   const topics=b.topics?.length?b.topics:defaults.topics;if(!Array.isArray(topics)||!topics.length)throw Error('请先选择学习方向');
   return invoke(b.target==='exam'?'exam':'practice',{...b,courseId:p.courseId,topics,practiceRequest:b.practiceRequest||defaults.practiceRequest||'',count:b.count||p.count,minutes:b.minutes||30,mode:b.mode||'practice',source:b.source||'generate',adaptive:typeof b.adaptive==='boolean'?b.adaptive:!b.count,explanationReviewed:!!b.explanationReviewed,title:b.target==='exam'?'个人复习试卷':'专项练习'});
  }
  throw Error('工作区任务不存在');
 },
 async route(path:string,b:any,admin:()=>void):Promise<any>{
  if(path==='quick/draft'||path==='quick/submit'){const result=quickAnswer(db,{...b,submit:path.endsWith('submit')},record);if(path.endsWith('submit'))reconcile();return result;}
  if(path==='self-check'){const result=selfCheck(db,b,record);reconcile();return result;}
  if(path==='self-check/undo'){
   const r=db.get(b.id);if(r?.kind!=='selfCheck'||r.undone)throw Error('核对记录已撤销或不存在');if(r.after.some((a:any)=>db.get(a.id)?.version!==a.version))throw Error('作答已有后续更正');
   db.db.exec('BEGIN');try{for(const a of r.before){if(a.old)db.put('attempt',a.old);else db.del(a.id);}syncLearning(db,r.courseId);db.put('selfCheck',{...r,undone:true});db.db.exec('COMMIT');}catch(e){db.db.exec('ROLLBACK');throw e;}reconcile();return {ok:true};
  }
  if(path==='article/collect')return collectArticle(db,b);
  if(path==='article/import')return importArticle(db,b);
  if(path==='article/page')return saveArticlePage(db,b);
  if(path==='document/save'){const d=db.get(b.id);if(d?.kind!=='document')throw Error('课件不存在');return db.put('document',{...d,progress:readingProgress(b.progress,d.progress)});}
  if(path==='article/save'){const a=db.get(b.id);if(a?.kind!=='article')throw Error('论文不存在');const data:any={};for(const k of ['notes','folder','tags','courseId','progress','bookmarks','highlights'])if(b[k]!==undefined)data[k]=b[k];if(data.progress)data.progress=readingProgress({...{page:1,scale:1,width:430,scroll:{top:0,left:0}},...data.progress},a.progress);if(data.courseId&&db.get(data.courseId)?.kind!=='course')throw Error('课程不存在');return db.put('article',{...a,...data},b.version);}
  if(path==='thread/create')return createThread(db,b);
  if(path==='thread/rename'){const t=db.get(b.id);if(t?.kind!=='thread')throw Error('对话不存在');return db.put('thread',{...t,title:String(b.title||'对话').slice(0,100)});}
  if(path==='skill/import'){admin();return importSkill(db,b);}
  if(path==='skill/update'){admin();const s=db.get(b.id);if(s?.kind!=='skill')throw Error('技能不存在');if(b.restore!==undefined){const v=s.history?.[Number(b.restore)];if(!v)throw Error('历史版本不存在');return importSkill(db,{name:s.name,files:Object.entries(v.files).map(([name,base64])=>({name,base64}))});}return db.put('skill',{...s,enabled:b.enabled??s.enabled,scopes:b.scopes||s.scopes});}
  if(path==='skill/delete'){admin();if(db.get(b.id)?.kind!=='skill')throw Error('技能不存在');db.del(b.id);return {ok:true};}
  if(path==='skill/settings'){admin();db.set('skillSelection',b.selection||{});db.set('skillRuntime',{python:String(b.python||''),node:String(b.node||'')});return {ok:true};}
  if(path==='operation/confirm'){admin();const r=applyChanges(db,b.id,true);reconcile();return r;}
  if(path==='operation/undo'){admin();const r=undoChanges(db,b.id);reconcile();return r;}
  throw Error('工作区接口不存在');
 }
 };
}
