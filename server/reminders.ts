import type {Store} from "./db";
import type {DueItem} from "../shared/navigation";
type DB=Pick<Store,"list"|"get"|"setting"|"set">;
export const localDay=(now:Date)=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
const dateOK=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(new Date(value+"T12:00:00").getTime())&&localDay(new Date(value+"T12:00:00"))===value;
const timeOK=(v:unknown):v is string=>typeof v==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const active=(r:any)=>!r.status||["todo","partial"].includes(r.status);
export function dueItems(db:DB,now=new Date()):DueItem[]{
  const day=localDay(now),clock=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const preference=db.setting("preferences",{}),start=timeOK(preference.start)?preference.start:"18:00";
  const tasks=db.list("task"),plans=db.list("plan"),questions=db.list("question"),courses=new Set(db.list("course").map(c=>c.id));
  const validCourse=(id?:string)=>!id||courses.has(id);
  const due=(date:string,time:string)=>date<day||(date===day&&time<=clock);
  const results:DueItem[]=[],covered=new Set<string>();
  for(const p of [...plans].sort((a,b)=>String(a.date+a.start).localeCompare(String(b.date+b.start)))){
    if(!active(p)||!dateOK(p.date)||!timeOK(p.start))continue;
    const task=p.taskId?tasks.find(t=>t.id===p.taskId):null;
    if(p.taskId&&(!task||!active(task)))continue;
    const courseId=p.courseId||task?.courseId;if(!validCourse(courseId))continue;
    if(task?.questionId&&!questions.some(q=>q.id===task.questionId))continue;
    if(task&&covered.has(task.id))continue;
    if(task)covered.add(task.id);
    if(!due(p.date,p.start))continue;
    results.push({key:`plan:${p.id}:${p.date}:${p.start}`,title:p.title,courseId,date:p.date,time:p.start,overdue:p.date<day,target:{tab:"plan",id:p.id,date:p.date,courseId}});
  }
  for(const t of tasks){
    if(!active(t)||covered.has(t.id)||!validCourse(t.courseId))continue;
    const q=t.questionId?questions.find(q=>q.id===t.questionId):null;
    if(t.questionId&&!q)continue;
    if(t.deadline&&!dateOK(t.deadline))continue;
    const date=t.deadline||day;if(!due(date,start))continue;
    results.push({key:`task:${t.id}:${t.deadline||"daily"}`,title:t.title,courseId:t.courseId,date,time:start,overdue:date<day,target:q?{tab:"questions",id:q.id,courseId:q.courseId}:{tab:"plan",id:t.id,date,courseId:t.courseId}});
  }
  if(clock>=start){
    const attempts=db.list("attempt").filter(a=>a.confirmed).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    for(const q of questions){
      if(!q.wrong||!validCourse(q.courseId)||tasks.some(t=>t.questionId===q.id)||attempts.find(a=>a.questionId===q.id)?.outcome==="independent")continue;
      results.push({key:`question:${q.id}`,title:`复习第 ${q.number||"未编号"} 题：${(q.topics||[]).join("、")}`,courseId:q.courseId,date:day,time:start,overdue:false,target:{tab:"questions",id:q.id,courseId:q.courseId}});
    }
  }
  return results.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)||a.key.localeCompare(b.key));
}
export type ReminderDelivery=(items:DueItem[])=>Promise<boolean>;
export function reminderRunner(db:DB,deliver:ReminderDelivery){
  let running=false;
  return async(now=new Date())=>{
    if(running||db.setting("preferences",{}).notify===false)return 0;
    running=true;
    try{
      const day=localDay(now),ledger:Record<string,string>=db.setting("reminderLedger",{});
      const items=dueItems(db,now).filter(i=>ledger[i.key]!==day);
      if(!items.length||!await deliver(items))return 0;
      const kept:Record<string,string>={};
      // Keep recent keys only; closed or rescheduled items cannot bloat the ledger forever.
      const cutoff=localDay(new Date(now.getTime()-30*86400000));
      for(const [key,date] of Object.entries(ledger))if(date>=cutoff)kept[key]=date;
      for(const item of items)kept[item.key]=day;
      db.set("reminderLedger",kept);return items.length;
    }finally{running=false;}
  };
}
