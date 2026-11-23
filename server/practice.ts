import {Store} from './db';
import {practicePlan} from './learning';
import {jsonResult} from './ai';

const difficulties=['基础','进阶','综合','自动'];
function topicNames(value:unknown,max:number){
 if(!Array.isArray(value)||value.length>max||value.some(t=>typeof t!=='string'||!t.trim()||t.trim().length>120))throw Error('知识点解析无效，请重新描述题型');
 return [...new Set((value as string[]).map(t=>t.trim()))];
}
// A preview is bound to its original course, text and checkbox selection. Learning
// allocation is deliberately not cached: confirmed attempts may have changed it.
export async function resolvePractice(db:Store,b:any,call:(prompt:string)=>Promise<string>){
 const request=typeof b.practiceRequest==='string'?b.practiceRequest.trim().slice(0,1500):'';
 const selectedTopics=topicNames(b.topics||[],30);let topics=selectedTopics,intent:any=null;
 if(b.previewId){
  const job=db.get(b.previewId),r=job?.result;
  if(job?.kind!=='job'||job.action!=='practice-preview'||job.status!=='done'||job.params?.courseId!==b.courseId||r?.request!==request||JSON.stringify(r?.selectedTopics)!==JSON.stringify(selectedTopics))throw Error('题型预览已变化，请重新解析并确认');
  intent=r.intent;topics=topicNames(r.topics,8);
 }else if(request){
  intent=jsonResult(await call('PRACTICE_INTENT：把用户的练习要求映射为明确知识点与解题题型。优先复用已有知识点名称，也允许本课程的新知识点。要求太模糊则填写 clarification，不擅自猜测。保留用户指定的条件、问法和难度。只输出 JSON {"topics":["知识点"],"type":"完整题型要求","difficulty":"基础|进阶|综合|自动","clarification":"需要补充的问题或空字符串"}。用户要求：'+request+'；已选知识点：'+JSON.stringify(selectedTopics)+'；已有知识点：'+JSON.stringify([...new Set(db.list('question').filter(q=>q.courseId===b.courseId).flatMap(q=>q.topics||[]))])));
  if(typeof intent.clarification==='string'&&intent.clarification.trim())throw Error('请补充练习要求：'+intent.clarification.trim().slice(0,500));
  topics=topicNames(intent.topics,8);
 }
 if(!topics.length)throw Error('请说明想练习的题型或选择知识点');
 if(intent){
  if(!difficulties.includes(intent.difficulty)||typeof intent.type!=='string'||!intent.type.trim())throw Error('题型或难度解析无效，请重新描述题型');
  intent={topics,type:intent.type.trim().slice(0,1500),difficulty:intent.difficulty,clarification:''};
 }
 return {request,selectedTopics,topics,intent};
}

export function practiceAllocation(db:Store,b:any,topics:string[],intent:any){
 const plan=practicePlan(db,b.courseId,topics,Number(b.minutes)||30);
 if(intent&&intent.difficulty!=='自动')for(const row of plan.rows)if(!row.diagnostic)row.difficulty=intent.difficulty;
 if(b.adaptive===false){
  const requested=Math.max(1,Math.min(20,Math.floor(Number(b.count)||3)));let remaining=plan.budget,count=0;
  for(const row of plan.rows)row.count=0;
  for(let round=0;round<20&&count<requested;round++)for(const row of plan.rows){
   if(count>=requested)break;
   if((!row.diagnostic||row.count<1)&&remaining>=row.perQuestion){row.count++;count++;remaining-=row.perQuestion;}
  }
  plan.count=count;plan.minutes=plan.budget-remaining;plan.deferred=requested-count;
  plan.action='使用手动题量；仍遵守可用时间与单知识点诊断要求';
 }
 return plan;
}

export function validatePracticeAllocation(questions:any[],allocation:ReturnType<typeof practiceAllocation>,intent:any){
 for(const row of allocation.rows){
  const assigned=questions.filter(q=>q.primaryTopic===row.topic);
  if(assigned.length!==row.count)throw Error('知识点题量分配不符，未发布');
  if(row.diagnostic&&assigned.some(q=>q.topics.length!==1))throw Error('诊断题必须定位单知识点');
  if((row.diagnostic||row.effective==='较熟练'||(intent&&intent.difficulty!=='自动'))&&assigned.some(q=>q.difficulty!==row.difficulty))throw Error('生成题难度不符合本轮要求，未发布');
 }
}
