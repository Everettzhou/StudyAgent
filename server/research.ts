import type {Store} from './db';
import {publicGet,publicBuffer,plain} from './net';
import {saveFile} from './files';
import {createHash} from 'node:crypto';
import {get} from 'node:https';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const stamp=()=>new Date().toISOString();
export function normalizeWork(w:any){
 const doi=String(w.DOI||'').toLowerCase(),url=doi?'https://doi.org/'+doi:String(w.URL||'');
 return {title:plain(String(w.title?.[0]||'未提供标题')),doi,url,authors:(w.author||[]).map((a:any)=>[a.given,a.family].filter(Boolean).join(' ')),year:w.published?.['date-parts']?.[0]?.[0]||w.issued?.['date-parts']?.[0]?.[0]||null,venue:w['container-title']?.[0]||w.publisher||'',type:w.type||'unknown',citations:Number.isInteger(w['is-referenced-by-count'])?w['is-referenced-by-count']:null,abstract:plain(w.abstract||''),citationSource:'Crossref Cited-by',metadataSource:doi?'https://api.crossref.org/works/'+encodeURIComponent(doi):'',fetchedAt:stamp(),peerReview:'未核实',updates:w['update-to']||[],relations:w.relation||{},links:(w.link||[]).filter((l:any)=>l['content-type']==='application/pdf').map((l:any)=>l.URL),status:w.abstract?'有摘要':'仅题录',metadataVerified:!!doi};
}
// Fixed registry only. TLS hostname verification remains enabled, including
// on local VPNs that resolve public names to a fake-IP routing range.
export function crossrefGet(address:string):Promise<string>{
 const url=new URL(address);if(url.origin!=='https://api.crossref.org'||url.username||url.password||!url.pathname.startsWith('/works'))throw Error('论文元数据地址无效');
 return new Promise((resolve,reject)=>{const req=get(url,{headers:{'User-Agent':'ZhixuStudyAgent/0.1.9','Accept':'application/json'}},res=>{if(res.statusCode!==200){res.resume();reject(Error('Crossref 返回 '+res.statusCode));return;}let size=0;const chunks:Buffer[]=[];res.on('data',(c:Buffer)=>{size+=c.length;if(size>4_000_000)req.destroy(Error('论文元数据过大'));else chunks.push(c);});res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject);});req.setTimeout(20000,()=>req.destroy(Error('Crossref 检索超时，请重试')));req.on('error',reject);});
}
export async function searchResearch(db:Store,b:any,fetchText=crossrefGet){
 const q=String(b.query||'').trim();if(!q)throw Error('请输入主题、作者、标题或 DOI');
 const doi=q.replace(/^https?:\/\/(?:dx\.)?doi.org\//i,'');const direct=/^10\.\d{4,9}\/.+/.test(doi);
 const params=new URLSearchParams({'query.bibliographic':q,rows:'20',offset:String(Math.max(0,Math.min(1000,Number(b.offset)||0)))});
 if(b.sort==='citations')params.set('sort','is-referenced-by-count');else if(b.sort==='year')params.set('sort','published');
 if(b.year&&/^\d{4}$/.test(String(b.year)))params.set('filter','from-pub-date:'+b.year+'-01-01');
 const url=direct?'https://api.crossref.org/works/'+encodeURIComponent(doi):'https://api.crossref.org/works?'+params;
 const data=JSON.parse(await fetchText(url)),works=direct?[data.message]:data.message?.items;if(!Array.isArray(works))throw Error('论文检索响应无效');
 return db.put('researchSearch',{query:q,url,rows:works.map(normalizeWork),total:direct?1:data.message['total-results'],offset:Number(b.offset)||0,at:stamp()});
}
export function collectArticle(db:Store,b:any){
 const search=db.get(b.searchId),entry=search?.kind==='researchSearch'?search.rows[b.index]:null;if(!entry)throw Error('请先检索并选择论文');
 const old=db.list('article').find(a=>a.doi&&a.doi===entry.doi);if(old)return old;
 return db.put('article',{...entry,tags:[],folder:'',notes:'',at:stamp()});
}
export function importArticle(db:Store,b:any){
 const raw=Buffer.from(String(b.base64||''),'base64');if(raw.subarray(0,5).toString()!=='%PDF-')throw Error('请导入 PDF 原件');
 const f=saveFile(db.dir,b.base64),old=db.list('article').find(a=>a.hash===f.hash);if(old)return old;
 const target=b.articleId?db.get(b.articleId):null;if(b.articleId&&target?.kind!=='article')throw Error('关联论文不存在');
 if(target?.hash&&target.hash!==f.hash)throw Error('该论文已有原件，请作为新记录导入，避免改变已有引用');
 return db.put('article',{...target,...f,title:target?.title||String(b.name||'本地论文').slice(0,300),name:String(b.name||'paper.pdf'),mime:'application/pdf',status:'PDF 已导入，待读取',tags:target?.tags||[],notes:target?.notes||'',metadataVerified:target?.metadataVerified||false,at:target?.at||stamp()});
}
export async function downloadArticle(db:Store,b:any){
 const a=db.get(b.articleId);if(a?.kind!=='article')throw Error('论文不存在');
 const url=String(b.url||a.links?.[0]||'');if(!url)throw Error('此记录没有全文直链，可打开原始来源或上传 PDF');
 const bytes=await publicBuffer(url,30*1024**2);return importArticle(db,{articleId:a.id,name:a.title+'.pdf',base64:bytes.toString('base64')});
}
export async function importArticleUrl(db:Store,b:any){
 const url=new URL(String(b.url||''));if(!['https:','http:'].includes(url.protocol))throw Error('请输入网页或 PDF 链接');
 if(/^(dx\.)?doi\.org$/i.test(url.hostname)){const s=await searchResearch(db,{query:url.href});return collectArticle(db,{searchId:s.id,index:0});}
 const bytes=await publicBuffer(url.href,30*1024**2);
 if(bytes.subarray(0,5).toString()==='%PDF-'){const a=importArticle(db,{name:decodeURIComponent(url.pathname.split('/').at(-1)||'paper.pdf'),base64:bytes.toString('base64')});return db.put('article',{...a,url:url.href});}
 const html=bytes.toString('utf8'),doi=html.match(/10\.\d{4,9}\/[a-zA-Z0-9._;()/:+-]+/)?.[0]?.replace(/[.,;]+$/,'');
 if(doi){const s=await searchResearch(db,{query:doi});return collectArticle(db,{searchId:s.id,index:0});}
 const old=db.list('article').find(a=>a.url===url.href);return old||db.put('article',{title:plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||url.hostname).slice(0,300),url:url.href,status:'仅网页链接，待补充 PDF',metadataVerified:false,citations:null,tags:[],notes:'',at:stamp()});
}
export function saveArticlePage(db:Store,b:any){
 const a=db.get(b.articleId),n=Number(b.number);if(a?.kind!=='article'||!a.hash||!Number.isInteger(n)||n<1||n>1000)throw Error('论文或页码无效');
 const id='article-page-'+hash(a.id+'|'+n),old=db.get(id),text=String(b.text||'').slice(0,100000);
 // Keep existing text immutable when a renderer reopens a page; OCR corrections are explicit.
 if(old?.text&&!b.correct)return old;
 const page=db.put('articlePage',{...old,id,articleId:a.id,number:n,text,ocr:!!b.ocr,at:stamp()});
 db.put('article',{...a,pages:Math.max(a.pages||0,n),status:'已取得全文'});return page;
}
export function articleSources(db:Store,articleIds:string[],query:string,pageNumber?:number){
 const words=query.match(/[\u4e00-\u9fff]{2,4}|[A-Za-z]{3,}/g)||[];const out:any[]=[];
 for(const id of [...new Set(articleIds)].slice(0,5)){
  const a=db.get(id);if(a?.kind!=='article')continue;
  const pages=db.list('articlePage').filter(p=>p.articleId===a.id&&p.text).map(p=>({...p,score:(p.number===pageNumber?1000:0)+words.reduce((n,w)=>n+(p.text.includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score||a.number-b.number).slice(0,5);
  for(const p of pages)out.push({id:p.id,articleId:a.id,title:a.title,page:p.number,version:p.version,text:p.text.slice(0,16000),url:a.url||'',status:'全文片段'});
  if(!pages.length)out.push({id:a.id,articleId:a.id,title:a.title,version:a.version,text:a.abstract||a.title,url:a.url||'',status:a.abstract?'仅摘要':'仅题录'});
 }return out.slice(0,10);
}
export function validateCitations(citations:any,sources:any[]){
 if(!Array.isArray(citations))return [];return citations.slice(0,20).map((c:any)=>{const s=sources.find(x=>x.id===c.sourceId),quote=String(c.quote||'').trim();if(!s||!quote||!s.text.includes(quote)||quote.length>600)return null;return {index:Number(c.index),sourceId:s.id,articleId:s.articleId,documentId:s.documentId,pageId:s.pageId,courseId:s.courseId,title:s.title,page:s.page,url:s.url,version:s.version,status:s.status,quote};}).filter((c:any)=>c&&Number.isInteger(c.index)&&c.index>0);
}
