import {randomUUID,createHash} from 'node:crypto';
import type {Store} from './db';
import {jsonResult} from './ai';
import {recallPersonal} from './personal-memory';
import {topicState,syncLearning} from './learning';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function choiceQuestion(v:any){
 if(!v||typeof v.stem!=='string'||!v.stem.trim()||!['single','multiple'].includes(v.type))throw Error('选择题题干或类型无效');
 if(!Array.isArray(v.options)||v.options.length<2||v.options.length>8)throw Error('每题需要 2–8 个选项');
 const options=v.options.map((o:any,i:number)=>({id:String.fromCharCode(65+i),text:String(o.text||'').trim().slice(0,5000)}));
 if(options.some((o:any)=>!o.text)||new Set(options.map((o:any)=>o.text)).size!==options.length)throw Error('选项为空或重复');
 const correct=[...new Set<string>(v.correct||[])].sort();
 if(!correct.length||correct.some(id=>!options.some((o:any)=>o.id===id))||(v.type==='single'&&correct.length!==1))throw Error('正确选项集合无效');
 if(typeof v.explanation!=='string'||!v.explanation.trim()||!Array.isArray(v.topics)||!v.topics.length)throw Error('题目缺少详细解析或知识点');
 return {stem:v.stem.slice(0,20000),type:v.type,options,correct,topics:v.topics.map((t:any)=>String(t).slice(0,120)).slice(0,6),explanation:v.explanation.slice(0,30000),hint:String(v.hint||'请先确定题目考查的概念和条件。').slice(0,3000),difficulty:['基础','进阶','综合'].includes(v.difficulty)?v.difficulty:'基础',variant:String(v.variant||'条件变化'),lane:v.lane==='explore'?'explore':'memory'};
}
export function quickPlan(db:Store,b:any){
 const course=db.get(b.courseId||'')||db.get(db.list('course')[0]?.id||'');if(course?.kind!=='course')throw Error('先选择一个学习方向或新建课程，无需填写其他设置');
 const qs=db.list('question').filter(q=>q.courseId===course.id),topics=[...new Set<string>(qs.flatMap(q=>q.topics||[]))];
 const states=topics.map(t=>topicState(db,course.id,t));
 const weak=states.filter(s=>s.effective!=='较熟练').map(s=>s.topic);
 const count=b.count!==undefined&&b.count!==''?Number(b.count):states.some(s=>s.repeated)?10:states.length&&states.every(s=>s.effective==='较熟练')?5:8;
 const ratio=b.ratio!==undefined&&b.ratio!==''?Number(b.ratio):80;
 if(!Number.isInteger(count)||count<1||count>20||!Number.isFinite(ratio)||ratio<0||ratio>100)throw Error('题量为 1–20，记忆比例为 0–100');
 const focus=String(b.focus||'').trim();const memories=db.list('memory').filter(m=>m.courseId===course.id&&!m.disabled).slice(0,8).map(m=>m.text);memories.push(...recallPersonal(db,focus||'学习薄弱点 复习',course.id).map((m:any)=>m.text));
 return {courseId:course.id,course:course.name,count,ratio,memoryCount:Math.round(count*ratio/100),focus,weak,topics,difficulty:b.difficulty|| (states.length&&states.every(s=>s.effective==='较熟练')?'综合':'自动'),choiceType:b.choiceType||'mixed',memories,reason:focus?'按你的指定要求，缺失设置由学习记录补全':`根据${course.name}的学习记录安排 ${count} 题，约 ${ratio}% 针对学习情况，其余为课程内拓展`};
}
export async function generateQuick(db:Store,b:any,call:(s:string)=>Promise<string>,signal:AbortSignal){
 const plan=quickPlan(db,b);if(db.get(plan.courseId)?.cloud!==true)throw Error('请先开启当前课程的模型发送设置');
 const result=jsonResult(await call('QUICK_CHOICES\n只生成选择题，包括单选 single 或多选 multiple。用户指定类型时遵守。把填空题改为有意义的干扰选项；拓展题必须属于当前课程。严格遵守题数和 memory/explore 数量。难度较高时增加综合应用。逐项解释正确原因及干扰选项错误原因。JSON {questions:[{stem,type,options:[{text}],correct:["A"],topics:["知识点"],explanation,hint,difficulty:"基础|进阶|综合",variant,lane:"memory|explore"}]}。选项按 A、B、C 顺序编号。设置：'+JSON.stringify(plan)));
 if(!Array.isArray(result.questions)||result.questions.length!==plan.count)throw Error('生成题量不符，请重试');
 const rows=result.questions.map(choiceQuestion);
 if(rows.filter((q:any)=>q.lane==='memory').length!==plan.memoryCount)throw Error('记忆与拓展题比例不符，未发布');
 if(['single','multiple'].includes(plan.choiceType)&&rows.some((q:any)=>q.type!==plan.choiceType))throw Error('选择题类型不符');
 const checked=jsonResult(await call('QUICK_VERIFY\n独立求解并核对全部选择题，检查答案集合、歧义、选项重复和解析错误。只返回 {"valid":true或false,"issues":[]}。'+JSON.stringify(rows)));
 if(checked.valid!==true)throw Error('题目未通过独立核验，未发布');signal.throwIfAborted();
 const id=randomUUID();db.db.exec('BEGIN');try{
  const questions=rows.map((q:any,i:number)=>db.put('question',{...q,courseId:plan.courseId,number:String(i+1),answer:q.correct.join('、'),origin:'generated',source:'模型生成 · 独立模型核验',wrong:false,status:'已核验',id:randomUUID()}));
  const batch=db.put('quickBatch',{id,courseId:plan.courseId,plan,questionIds:questions.map((q:any)=>q.id),drafts:{},at:new Date().toISOString()});db.db.exec('COMMIT');return batch;
 }catch(e){db.db.exec('ROLLBACK');throw e;}
}
export function quickAnswer(db:Store,b:any,record:(q:any,a:any)=>any){
 const batch=db.get(b.batchId),q=db.get(b.questionId);if(batch?.kind!=='quickBatch'||!batch.questionIds.includes(q?.id))throw Error('题目不属于本轮练习');
 const id='quick-'+digest(batch.id+'|'+q.id),old=db.get(id);if(b.submit&&old)return old;
 if(!Array.isArray(b.selected)||b.selected.some((x:any)=>!q.options.some((o:any)=>o.id===x))||(q.type==='single'&&b.selected.length>1))throw Error('选项无效');
 const selected=[...new Set<string>(b.selected)].sort(),prior=batch.drafts[q.id]||{};
 if(b.reveal&&!['hint','answer'].includes(b.reveal))throw Error('提示类型无效');
 const draft={selected,assistance:prior.assistance==='answer'||b.reveal==='answer'?'answer':prior.assistance==='hint'||b.reveal==='hint'?'hint':null};
 if(!b.submit){if(b.version!==undefined&&batch.version!==b.version)throw Error('草稿已更新，请刷新后重试');return db.put('quickBatch',{...batch,drafts:{...batch.drafts,[q.id]:draft}});}
 if(!selected.length&&!b.skip)throw Error('请选择选项或跳过');
 const correct=JSON.stringify(selected)===JSON.stringify(q.correct.slice().sort());
 const outcome=b.skip?'skip':!correct?'wrong':draft.assistance==='answer'?'reviewed':draft.assistance==='hint'?'prompted':b.guessed?'unspecified':'independent';
 db.db.exec('BEGIN');try{const a=record(q,{id,outcome,answer:selected.join('、'),novel:!db.list('attempt').some(a=>a.questionId===q.id),notes:`快捷练习；${correct?'选项正确':selected.some(x=>!q.correct.includes(x))?'错选':'漏选'}${b.guessed?'；蒙对或不确定':''}`});db.put('quickBatch',{...batch,drafts:{...batch.drafts,[q.id]:draft}});const result=db.put('attempt',{...a,quickBatchId:batch.id,selected,correct,assistance:draft.assistance,gradingSource:'选项集合比对'});db.db.exec('COMMIT');return result;}catch(e){db.db.exec('ROLLBACK');throw e;}
}
export function selfCheck(db:Store,b:any,record:(q:any,a:any)=>any){
 const exam=db.get(b.examId);if(exam?.kind!=='exam'||!exam.snapshot)throw Error('试卷不存在');
 if(exam.version!==b.version)throw Error('试卷已更新，请刷新后重新核对');
 const parse=(v:any)=>{const nums=String(v||'').split(/[^0-9]+/).filter(Boolean).map(Number);if(nums.some(n=>n<1||n>exam.questionIds.length))throw Error('存在不属于本卷的题号');return [...new Set(nums)];};
 const wrong=parse(b.wrong),guessed=parse(b.guessed),skipped=parse(b.skipped);if(new Set([...wrong,...guessed,...skipped]).size!==wrong.length+guessed.length+skipped.length)throw Error('同一题不能同时标为错误、蒙对和未做');
 if(!b.allChecked&&!wrong.length&&!guessed.length&&!skipped.length)throw Error('请报题号或勾选已核对全卷');
 const before:any[]=[];db.db.exec('BEGIN');try{
  for(let i=0;i<exam.snapshot.length;i++){const n=i+1;if(!b.allChecked&&![...wrong,...guessed,...skipped].includes(n))continue;const q=exam.snapshot[i],id='paper-attempt-'+digest(exam.id+'|'+q.id),old=db.get(id);before.push({id,old});const outcome=wrong.includes(n)?'wrong':skipped.includes(n)?'skip':'unspecified';const data={id,outcome,answer:'用户自行核对',notes:guessed.includes(n)?'用户自评：蒙对':'用户自评：已核对答案',novel:false};if(old)db.put('attempt',{...old,...data,confirmed:true,at:new Date().toISOString(),gradingSource:'self-check'});else{const a=record(q,data);db.put('attempt',{...a,examId:exam.id,gradingSource:'self-check'});}}
  syncLearning(db,exam.courseId);db.put('exam',{...exam,selfCheckedAt:new Date().toISOString()});const receipt=db.put('selfCheck',{examId:exam.id,courseId:exam.courseId,before,after:before.map(x=>({id:x.id,version:db.get(x.id).version})),at:new Date().toISOString(),count:before.length});db.db.exec('COMMIT');return receipt;
 }catch(e){db.db.exec('ROLLBACK');throw e;}
}
