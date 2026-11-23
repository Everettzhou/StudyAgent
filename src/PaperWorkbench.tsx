import {useEffect,useState} from 'react';
import * as pdfjs from 'pdfjs-dist';
import {UploadButton} from './UploadButton';
type Item=Record<string,any>;
const call=async(path:string,body:any)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
const base64=(f:Blob)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});
const modes=[['unspecified','未说明'],['independent','独立完成'],['prompted','看过提示'],['reviewed','参考答案后重做']];
export function PaperWorkbench({exam,records,run,job,busy}:{exam:Item;records:Item;run:any;job:any;busy:boolean}){
 const submissions=(records.paperSubmission||[]).filter((s:Item)=>s.examId===exam.id);
 const [id,setId]=useState(''),[rows,setRows]=useState<Item[]>([]),[status,setStatus]=useState(''),[spaceLines,setSpaceLines]=useState(8);
 const current=submissions.find((s:Item)=>s.id===id)||submissions[0];
 useEffect(()=>{setRows(current?.rows.map((r:Item)=>({...r,recognitionConfirmed:r.recognitionConfirmed||false,independence:r.independence||'unspecified'}))||[]);},[current?.id,current?.version]);
 const edit=(index:number,values:Item)=>setRows(old=>old.map((r,i)=>i===index?{...r,...values}:r));
 const exportPdf=(answers:boolean)=>run(async()=>{const d=await call('pdf',{id:exam.id,answers,spaceLines});const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(d.base64),(c)=>c.charCodeAt(0))],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=d.name+(answers?'－答案解析':'－作答卷')+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 async function upload(files:File[]){
  if(!files.length)return;const pages:string[]=[];
  const asset=async(file:Blob,name:string,mime:string,extra:Item={})=>call('paper/asset',{examId:exam.id,name,mime,base64:await base64(file),...extra});
  for(const file of files){
   if(file.size>30*1024*1024)throw Error('单文件最多 30 MB，请拆分');
   const mime=file.name.toLowerCase().endsWith('.pdf')?'application/pdf':file.type;
   if(!['application/pdf','image/png','image/jpeg'].includes(mime))throw Error('请选择 PDF、PNG 或 JPEG');
   const original=await asset(file,file.name,mime);
   if(mime==='application/pdf'){
    const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    try{if(pdf.numPages+pages.length>60)throw Error('每次最多 60 页，请拆分');for(let n=1;n<=pdf.numPages;n++){
     setStatus(`正在准备 ${file.name} · ${n}/${pdf.numPages}`);const p=await pdf.getPage(n),size=p.getViewport({scale:1}),vp=p.getViewport({scale:Math.min(1.5,1800/Math.max(size.width,size.height))}),canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;await p.render({canvas,viewport:vp}).promise;
     const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('页面渲染失败')),'image/png'));
     const text=(await p.getTextContent()).items.map((i:any)=>i.str||'').join(' ');const stored=await asset(blob,file.name+' · '+n,'image/png',{sourceId:original.id,page:n,text});pages.push(stored.id);
    }}finally{await pdf.destroy();}
   }else{pages.push(original.id);}
   if(pages.length>60)throw Error('每次最多 60 页');
  }
  const s=await call('paper/submission',{examId:exam.id,pages});setId(s.id);setStatus(s.status==='已确认'?'同一份作答已确认，未重复计分':'已绑定原卷，请识别或手动转写并核对');
 }
 const activeJob=(records.job||[]).find((j:Item)=>j.params?.submissionId===current?.id&&['running','queued'].includes(j.status));
 return <section className="paper-workbench" aria-label="纸笔作答工作台">
  <h3>下载与纸笔作答</h3><p className="muted">卷号 {exam.code||exam.id} · 原题与题号保持不变。照片或 PDF 绑定此卷，核对后才更新学习记录。</p>
  <div className="toolbar"><label>每题书写留白（行）<input aria-label="每题书写留白" type="number" min={3} max={24} value={spaceLines} onChange={e=>setSpaceLines(Number(e.target.value))}/></label><button disabled={busy} onClick={()=>void exportPdf(false)}>下载作答卷 PDF</button><button className="secondary" disabled={busy||(exam.mode==='exam'&&!exam.submitted)} onClick={()=>void exportPdf(true)}>下载详细答案 PDF</button></div>
  <UploadButton>上传整卷作答（照片 / PDF）<input aria-label="整卷作答文件" hidden multiple type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(!busy)void run(()=>upload(files));}}/></UploadButton><p role="status">{status}</p>
  {submissions.length>0&&<label>选择上传批次<select aria-label="上传批次" value={current?.id||''} onChange={e=>setId(e.target.value)}>{submissions.map((s:Item)=><option value={s.id} key={s.id}>{new Date(s.at).toLocaleString()} · {s.status}</option>)}</select></label>}
  {current&&<>
   <details><summary>原始作答页与匹配核对（{current.pages.length} 页）</summary><div className="paper-pages">{current.pages.map((id:string,i:number)=>{const p=(records.paperAsset||[]).find((p:Item)=>p.id===id);return p&&<figure key={id}><a href={'/api/file/'+p.hash} target="_blank" rel="noreferrer"><img alt={'作答第 '+(i+1)+' 页'} src={'/api/file/'+p.hash}/></a><figcaption>第 {i+1} 页 · {p.name}</figcaption></figure>;})}</div></details>
   {(current.warnings||[]).map((w:string,i:number)=><p className="alert" key={i}>{w}</p>)}
   <div className="toolbar"><button disabled={busy||!!activeJob||current.status==='已确认'} onClick={()=>void job('paper-grade',{submissionId:current.id})}>识别并评估整卷</button><button className="secondary" disabled={busy||!!activeJob||current.status==='已确认'} onClick={()=>void run(()=>call('paper/review',{id:current.id,version:current.version,rows}),'校对已保存，请重新评估')}>保存转写与页码校对</button><span>{activeJob?.progress||current.status}</span></div>
   <label>整卷完成方式<select aria-label="整卷完成方式" defaultValue="unspecified" onChange={e=>setRows(rows=>rows.map(r=>({...r,independence:e.target.value})))}>{modes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <p className="hint">“未说明”不作为熟练度提升证据；漏拍题选“跳过”，不是答错。更正结果或识别文字时请填写依据。综合题答错先标记综合应用待加强，再做单知识点诊断。</p>
   {rows.map((row,i)=><article className="paper-answer" key={row.questionId}><h4>第 {row.number} 题</h4><div className="form-grid"><label>作答转写<textarea aria-label={'第'+row.number+'题作答转写'} rows={3} value={row.text} onChange={e=>edit(i,{text:e.target.value})}/></label><div><div>所属作答页（可跨页）<span className="paper-page-links">{current.pages.map((p:string,n:number)=><label className="check" key={p}><input type="checkbox" checked={row.pages.includes(p)} onChange={e=>edit(i,{pages:e.target.checked?[...row.pages,p]:row.pages.filter((x:string)=>x!==p)})}/>第 {n+1} 页</label>)}</span></div><label className="check"><input type="checkbox" checked={!!row.unclear} onChange={e=>edit(i,{unclear:e.target.checked})}/>仍有识别疑点（校对后取消再评估）</label></div></div>
    <p className="paper-analysis">{row.analysis}</p><div className="form-grid"><label>确认作答结果<select aria-label={'第'+row.number+'题结果'} value={row.outcome} onChange={e=>edit(i,{outcome:e.target.value})}><option value="uncertain">待核对</option><option value="correct">答对</option><option value="wrong">答错</option><option value="skip">跳过 / 漏拍</option></select></label><label>完成方式<select aria-label={'第'+row.number+'题完成方式'} value={row.independence} onChange={e=>edit(i,{independence:e.target.value})}>{modes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
    <label>人工修正依据 / 备注<input aria-label={'第'+row.number+'题修正依据'} value={row.notes||''} onChange={e=>edit(i,{notes:e.target.value})}/></label><label className="check"><input aria-label={'核对第'+row.number+'题'} type="checkbox" checked={!!row.recognitionConfirmed} onChange={e=>edit(i,{recognitionConfirmed:e.target.checked})}/>我已核对该题作答文字与结果</label>
   </article>)}
   <button disabled={busy||!!activeJob||rows.some(r=>r.outcome==='uncertain'||(r.outcome!=='skip'&&!r.recognitionConfirmed))} onClick={()=>void run(()=>call('paper/confirm',{id:current.id,version:current.version,rows}),'已更新记忆、错题本和下一轮复习安排')}>{current.status==='已确认'?'保存批改纠正并重新计算':'确认批改并更新学习记录'}</button>
   {current.status==='已确认'&&<p className="hint">已核对 {current.rows.filter((r:Item)=>r.outcome!=='skip').length} 题，答对 {current.rows.filter((r:Item)=>r.outcome==='correct').length} 题；跳过 {current.rows.filter((r:Item)=>r.outcome==='skip').length} 题（不计错）。记录已保存。重复上传不会重复计分；纠正会更新原记录，历史版本保留。</p>}
  </>}
 </section>;
}
export function MasteryControls({course,topics,state,run}:{course:string;topics:string[];state:Item;run:any}){
 return <details className="mastery-controls"><summary>手动掌握标记与自动评估</summary>{topics.map(t=>{const s=state.masteryDetails?.[course+'|'+t]||{};return <div className="mastery-row" key={t}><strong>{t}</strong><span>自动：{s.automatic||'待评估'}</span><label>掌握标记<select aria-label={t+'掌握标记'} value={s.manual||'auto'} onChange={e=>void run(()=>call('mastery',{courseId:course,topic:t,value:e.target.value,version:s.version}),'已更新后续安排，历史证据保持不变')}><option value="auto">自动评估</option><option value="较熟练">已掌握（手动）</option><option value="薄弱">不熟练（手动）</option></select></label>{s.conflict&&<p className="alert">新作答与手动标记不一致，请确认是否调整，或选择“自动评估”。当前手动标记未被覆盖。</p>}</div>;})}</details>;
}
