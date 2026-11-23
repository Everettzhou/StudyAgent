import type {Store} from './db';
import {unzipSync,strFromU8} from 'fflate';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readdirSync,readFileSync,statSync,lstatSync} from 'node:fs';
import {join,resolve,dirname,extname,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function safeRelative(s:string){const n=s.replace(/\\/g,'/');if(!n||n.startsWith('/')||/[\x00-\x1f<>:"|?*]/.test(n)||n.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||n.length>240)throw Error('技能文件路径无效');return n;}
export function importSkill(db:Store,b:any){
 let files:Record<string,string>={};
 if(b.zip){const buf=Buffer.from(b.zip,'base64');if(buf.length>10*1024**2)throw Error('技能包上限 10 MB');let total=0,count=0;const extracted=unzipSync(buf,{filter:f=>{total+=f.originalSize;count++;if(total>20*1024**2||count>200)throw Error('技能展开大小或文件数超限');return !f.name.endsWith('/');}});for(const [name,bytes] of Object.entries(extracted))files[safeRelative(name)]=Buffer.from(bytes).toString('base64');}
 else for(const f of b.files||[]){const name=safeRelative(String(f.name));files[name]=String(f.base64||'');}
 const names=Object.keys(files);if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw Error('技能文件名大小写冲突');
 const roots=names.filter(n=>n==='SKILL.md'||n.endsWith('/SKILL.md'));if(roots.length!==1)throw Error('每次导入一个包含 SKILL.md 的技能包');
 const prefix=roots[0].slice(0,-8);files=Object.fromEntries(Object.entries(files).filter(([n])=>n.startsWith(prefix)).map(([n,v])=>[n.slice(prefix.length),v]));
 if(Object.keys(files).length>200||Object.values(files).reduce((s,v)=>s+Buffer.byteLength(v,'base64'),0)>20*1024**2)throw Error('技能包内容超限');
 const instruction=Buffer.from(files['SKILL.md'],'base64').toString('utf8');if(instruction.length>50000)throw Error('SKILL.md 太长');
 const header=instruction.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'';
 const field=(name:string)=>header.match(new RegExp('^'+name+':\\s*(.*)$','m'))?.[1]?.replace(/^['"]|['"]$/g,'').trim();
 const name=String(b.name||field('name')||'导入技能').slice(0,100),id='skill-'+hash(name).slice(0,24),old=db.get(id);
 const version={files,instruction,name,description:String(field('description')||name).slice(0,1000),at:new Date().toISOString()};
 return db.put('skill',{...old,id,...version,enabled:old?.enabled??true,scopes:old?.scopes||['partner','research','practice','planning'],history:old?[{files:old.files,instruction:old.instruction,name:old.name,description:old.description,at:old.at},...(old.history||[])].slice(0,3):[],hash:hash(JSON.stringify(files))});
}
export function skillsFor(db:Store,scope:string,query:string,ids?:string[]){
 if(ids===undefined){const saved=db.setting('skillSelection',{})[scope];if(Array.isArray(saved))ids=saved;}
 return db.list('skill').filter(s=>s.enabled&&(!s.scopes?.length||s.scopes.includes(scope))&&(ids?ids.includes(s.id):true)).map(s=>({...s,score:(String(query).match(/[\u4e00-\u9fff]{2,4}|[A-Za-z]{3,}/g)||[]).reduce((n,w)=>n+((s.description+s.name).includes(w)?1:0),0)})).filter(s=>ids||s.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
}
export function skillContext(db:Store,scope:string,query:string,ids?:string[]){
 const rows=skillsFor(db,scope,query,ids);return {ids:rows.map(s=>s.id),text:rows.map(s=>'技能 '+s.name+'（技能版本 '+s.hash+'）：\n'+s.instruction+'\n参考资料：'+Object.entries<string>(s.files).filter(([n])=>n!=='SKILL.md'&&/\.(md|txt|json|csv)$/i.test(n)).slice(0,4).map(([n,v])=>n+'\n'+Buffer.from(v,'base64').toString('utf8').slice(0,5000)).join('\n')+'\n可运行脚本：'+Object.keys(s.files).filter(n=>/\.(py|js|cjs|mjs)$/.test(n)).join(',')).join('\n\n').slice(0,28000)};
}
export async function runSkill(db:Store,b:any,signal:AbortSignal){
 const s=db.get(b.skillId);if(s?.kind!=='skill'||!s.enabled)throw Error('技能不存在或未启用');
 const script=safeRelative(String(b.script||''));if(!s.files[script]||!['.py','.js','.cjs','.mjs'].includes(extname(script)))throw Error('请选择技能内的 Python 或 Node 脚本');
 const id=randomUUID(),dir=join(db.dir,'skill-runs',id);mkdirSync(dir,{recursive:true});
 for(const [name,v] of Object.entries<string>(s.files)){const target=join(dir,safeRelative(name));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,Buffer.from(v,'base64'));}
 writeFileSync(join(dir,'input.json'),JSON.stringify({text:String(b.input||'').slice(0,50000),task:b.task||null},null,2));
 const cfg=db.setting('skillRuntime',{}),py=extname(script)==='.py';const executable=py?(cfg.python||'python'):(cfg.node||process.execPath);
 const args=Array.isArray(b.args)?b.args.map(String).slice(0,12):[];if(args.some((a:string)=>a.length>1000))throw Error('脚本参数过长');
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:dir,TMP:dir,PYTHONIOENCODING:'utf-8',STUDY_INPUT:join(dir,'input.json'),STUDY_OUTPUT:dir};if(!py&&!cfg.node&&process.versions.electron)env.ELECTRON_RUN_AS_NODE='1';
 let output='';const execution=db.put('skillRun',{id,skillId:s.id,skillName:s.name,skillHash:s.hash,script,status:'running',at:new Date().toISOString()});
 try{const exit=await new Promise<number>((resolve,reject)=>{const p=spawn(executable,[join(dir,script),...args],{cwd:dir,env,windowsHide:true,shell:false});let done=false;const stop=()=>{if(process.platform==='win32'&&p.pid)spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else p.kill('SIGKILL');};const timer=setTimeout(()=>{stop();reject(Error('技能运行超过 60 秒，已停止'));},60000);const abort=()=>{stop();reject(Error('技能运行已取消'));};signal.addEventListener('abort',abort,{once:true});const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};p.on('error',e=>{finish();reject(Error('脚本启动失败，请检查运行环境：'+e.message));});const capture=(v:Buffer)=>{output+=v.toString();if(output.length>2_000_000){stop();reject(Error('脚本输出超限'));}};p.stdout.on('data',capture);p.stderr.on('data',capture);p.on('close',code=>{finish();resolve(code??-1);});if(signal.aborted)abort();});signal.throwIfAborted();
  const outputs:any[]=[];function walk(path:string){for(const e of readdirSync(path,{withFileTypes:true})){const f=join(path,e.name),rel=relative(dir,f).replace(/\\/g,'/');if(e.isSymbolicLink()||lstatSync(f).isSymbolicLink())continue;if(e.isDirectory())walk(f);else if(!s.files[rel]&&rel!=='input.json'&&statSync(f).size<=10*1024**2&&outputs.length<30){const data=readFileSync(f),hash=createHash('sha256').update(data).digest('hex');writeFileSync(join(db.dir,'files',hash),data);outputs.push({name:rel,hash});}}}walk(dir);
  const result=db.put('skillRun',{...execution,status:exit===0?'done':'failed',exit,output:output.slice(-30000),outputs});if(exit!==0)throw Error('技能退出码 '+exit+'：'+output.slice(-1000));return result;
 }catch(e){db.put('skillRun',{...db.get(id),status:signal.aborted?'cancelled':'failed',error:String(e),output:output.slice(-30000)});throw e;}
}
