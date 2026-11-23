import type {Store} from './db';
import {resolveSelection} from './selection';
export function readingProgress(value:any,previous:any={}){
 if(!value||typeof value!=='object')throw Error('阅读进度无效');
 const n=(v:any,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 if(!Number.isInteger(value.page)||!n(value.page,1,1000)||!n(value.scale,0.3,4)||!n(value.width,280,1000)||!n(value.scroll?.top,0,1e7)||!n(value.scroll?.left,0,1e7))throw Error('阅读位置或缩放无效');
 if(value.updatedAt!==undefined&&!n(value.updatedAt,0,Number.MAX_SAFE_INTEGER))throw Error('阅读时间无效');
 if(previous.updatedAt&&(value.updatedAt||0)<previous.updatedAt)return previous;
 return {page:value.page,scale:value.scale,width:value.width,scroll:{top:value.scroll.top,left:value.scroll.left},chat:value.chat!==false,immersive:!!value.immersive,threadId:String(value.threadId||'').slice(0,100),updatedAt:value.updatedAt||Date.now()};
}
export function courseSources(db:Store,t:any,selected:any,pageId?:string){
 const doc=db.get(t.documentId);if(doc?.kind!=='document'||doc.courseId!==t.courseId)throw Error('关联课件不存在或已移至其他课程');
 let selectionContext='';
 if(selected){if(selected.source?.kind!=='page'||db.get(selected.source.id)?.documentId!==doc.id)throw Error('选区不属于当前课件');selectionContext=resolveSelection(db,t.courseId,selected.source,selected.excerpt,selected.region).context;}
 const target=selected?.source?.id||pageId;const pages=db.list('page').filter(p=>p.documentId===doc.id).sort((a,b)=>Number(b.id===target)-Number(a.id===target)||a.number-b.number).slice(0,5);
 return {selectionContext,sources:pages.map(p=>({id:p.id,documentId:doc.id,pageId:p.id,courseId:t.courseId,title:doc.name,page:p.number,version:p.version,text:String(p.text||'').slice(0,16000),status:p.text?'课件原文':'课件图片，文字未识别'}))};
}
