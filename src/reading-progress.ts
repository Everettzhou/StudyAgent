import {useEffect} from 'react';
export function readProgress(kind:string,id:string,remote:any={}){
 let local:any={};try{local=JSON.parse(localStorage.getItem('reading-progress-'+kind+'-'+id)||'{}');}catch{}
 const saved=(local.updatedAt||0)>(remote?.updatedAt||0)?local:remote||{};
 return {page:1,scale:1,width:430,chat:true,immersive:true,threadId:'',scroll:{top:0,left:0},...saved};
}
export function useProgressWriter(kind:'article'|'document',id:string,progress:any,enabled:boolean,call:(path:string,b:any)=>Promise<any>,error:(s:string)=>void){
 const key=JSON.stringify(progress);
 useEffect(()=>{
  if(!id||!enabled)return;
  const value={...progress,updatedAt:Date.now()},path='workspace/'+kind+'/save',body={id,progress:value};
  localStorage.setItem('reading-progress-'+kind+'-'+id,JSON.stringify(value));
  const save=()=>void call(path,body).catch(e=>error(String(e)));
  const timer=setTimeout(save,180);
  const leave=()=>{void fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});};
  window.addEventListener('pagehide',leave);
  return()=>{clearTimeout(timer);window.removeEventListener('pagehide',leave);save();};
 },[kind,id,key,enabled]);
}
