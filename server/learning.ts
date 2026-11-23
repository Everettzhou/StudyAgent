import {createHash} from 'node:crypto';
import {Store} from './db';
import {mastery} from './core';
export const keyFor=(courseId:string,topic:string)=>'mastery-'+createHash('sha256').update(courseId+'|'+topic).digest('hex').slice(0,24);
export const variants=['条件变化','不同问法','逆向推导','实际应用','综合应用'];
export function topicState(db:Store,courseId:string,topic:string){
 const rows=db.list('attempt').filter(a=>a.courseId===courseId&&a.confirmed&&(a.topics||[]).includes(topic)).sort((a,b)=>a.at.localeCompare(b.at));
 const automatic=mastery(rows),manual=db.get(keyFor(courseId,topic));
 const recent=rows.filter(a=>['independent','wrong','prompted','reviewed','unspecified'].includes(a.outcome)).slice(-3);
 const repeated=recent.filter(a=>a.outcome==='wrong').length>=2;
 const since=manual?rows.filter(a=>a.at>=(manual.at||'')):[];
 const conflict=manual?.value==='较熟练'?since.filter(a=>a.outcome==='wrong').slice(-3).length>=2:manual?.value==='薄弱'&&mastery(since)==='较熟练';
 return {topic,automatic,effective:manual?.value||automatic,manual:manual?.value||null,version:manual?.version,conflict:!!conflict,repeated,evidence:rows.map(a=>a.id)};
}
export function setMastery(db:Store,b:any){
 if(db.get(b.courseId)?.kind!=='course'||typeof b.topic!=='string'||!db.list('question').some(q=>q.courseId===b.courseId&&(q.topics||[]).includes(b.topic)))throw Error('知识点不存在');
 if(!['较熟练','薄弱','auto'].includes(b.value))throw Error('掌握标记无效');
 const id=keyFor(b.courseId,b.topic),old=db.get(id);
 if(old&&b.version!==old.version)throw Error('版本冲突，请刷新');
 const event=db.put('masteryEvent',{courseId:b.courseId,topic:b.topic,value:b.value,previous:old?.value||'auto',at:new Date().toISOString()});
 if(b.value==='auto')db.del(id);else db.put('masteryOverride',{id,courseId:b.courseId,topic:b.topic,value:b.value,at:event.at});
 return topicState(db,b.courseId,b.topic);
}
export function practicePlan(db:Store,courseId:string,topics:string[],minutes:number){
 const preferences=db.setting('preferences',{}),budget=Math.max(0,Math.min(Number(minutes)||0,Number(preferences.minutes)||90,180));
 const rows=[...new Set(topics)].map(topic=>{
  const state=topicState(db,courseId,topic),strong=state.effective==='较熟练',diagnostic=db.list('task').some(t=>t.courseId===courseId&&t.diagnostic&&t.status==='todo'&&(t.topics||[]).includes(topic));
  const target=diagnostic?1:strong?1:state.repeated||state.effective==='薄弱'?5:3;
  return {...state,diagnostic,target,count:0,perQuestion:strong&&!diagnostic?15:10,difficulty:diagnostic?'基础':strong?(db.list('question').some(q=>q.courseId===courseId&&q.difficulty==='进阶'&&q.topics?.includes(topic))?'综合':'进阶'):'基础 / 进阶',explainFirst:!strong&&state.repeated,variants:diagnostic?['条件变化']:strong?['逆向推导','实际应用','综合应用']:['条件变化','不同问法','实际应用']};
 }).sort((a,b)=>Number(b.diagnostic)-Number(a.diagnostic)||Number(b.effective==='薄弱')-Number(a.effective==='薄弱'));
 let remaining=budget,total=0;
 for(let round=0;round<5;round++)for(const row of rows)if(row.count<row.target&&remaining>=row.perQuestion&&total<20){row.count++;total++;remaining-=row.perQuestion;}
 return {rows,count:total,minutes:budget-remaining,budget,deferred:rows.reduce((n,r)=>n+r.target-r.count,0),action:total?'按知识点分配；未完成目标顺延，连续错误先讲解':'剩余时间不足，请安排下一次复习'};
}
export function syncLearning(db:Store,courseId:string){
 const preferences=db.setting('preferences',{}),attempts=db.list('attempt').filter(a=>a.courseId===courseId&&a.confirmed).sort((a,b)=>a.at.localeCompare(b.at));
 const qs=db.list('question').filter(q=>q.courseId===courseId);
 for(const q of qs){
  const rows=attempts.filter(a=>a.questionId===q.id);if(!rows.length)continue;
  const wrongs=rows.filter(a=>a.outcome==='wrong'),latest=rows.at(-1),topics=q.topics||[];
  const consolidated=latest.outcome!=='wrong'&&topics.length>0&&topics.every((t:string)=>topicState(db,courseId,t).effective==='较熟练');
  db.put('question',{...q,initialWrong:q.initialWrong??q.wrong,wrong:!!(q.initialWrong??q.wrong)||wrongs.length>0,errorCount:wrongs.length,consolidated,learningStatus:consolidated?'已巩固':wrongs.length?'待巩固':'已记录'});
  const id='review-'+q.id,task=db.get(id);
  const diagnostic=topics.length>1&&wrongs.length>0&&topics.some((t:string)=>!attempts.some(a=>a.at>wrongs.at(-1).at&&a.topics?.length===1&&a.topics[0]===t&&['independent','wrong','prompted','reviewed','unspecified'].includes(a.outcome)));
  if(preferences.autoReview!==false){
   if(wrongs.length&&!consolidated)db.put('task',{...task,id,courseId,questionId:q.id,topics,title:diagnostic?'综合应用待加强：先做单知识点诊断':`复习 ${topics.join('、')}`,diagnostic,minutes:topics.length>1?20:30,priority:2,agentOwned:true,status:task?.status==='skip'?'skip':'todo',reason:'已确认作答联动；基础讲解后分批变式，剩余时间不足时顺延'});
   else if(task?.agentOwned)db.put('task',{...task,status:'done',reason:consolidated?'知识点已巩固，保留历史':'批改已纠正，撤销错误安排'});
  }
 }
 // Deterministic evidence summaries are rebuilt on corrections, never invented causes.
 if(preferences.autoMemory!==false)for(const topic of new Set(qs.flatMap(q=>q.topics||[]))){
  const s=topicState(db,courseId,String(topic)),rows=attempts.filter(a=>(a.topics||[]).includes(topic)),id='evidence-'+keyFor(courseId,String(topic));
  const old=db.get(id);if(db.setting('personalMemoryGuard',{ids:[]}).ids.includes(id))continue;if(old?.disabled||old?.manualLocked||old?.type==='explicit')continue;
  if(!rows.length){if(old)db.del(id);continue;}
  db.put('memory',{id,courseId,type:'fact',derived:true,verified:true,text:`${topic}：${rows.length} 次已确认记录，${rows.filter(a=>a.outcome==='wrong').length} 次错误；当前 ${s.effective}${s.manual?'（用户手动标记）':''}。独立完成为用户自述；不从最终答案推断错因。`,evidence:rows.map(a=>a.id),at:new Date().toISOString()});
 }
}
