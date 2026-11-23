import type {Store} from './db';
import {saveFile,space} from './files';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function uploadPartnerImage(db:Store,b:any){
 if(typeof b.base64!=='string'||b.base64.length>17*1024*1024)throw Error('图片上限 12 MB');
 const bytes=Buffer.from(b.base64,'base64');
 const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
 if(!mime||mime!==b.mime||bytes.length>12*1024*1024)throw Error('请选择真实的 PNG/JPEG 图片（最多 12 MB）');
 if(space(db.dir).low)throw Error('可用空间不足，请先清理空间');
 const f=saveFile(db.dir,b.base64),id='partner-image-'+f.hash;
 return db.get(id)||db.put('partnerImage',{id,...f,mime,name:String(b.name||'图片').slice(0,150),at:new Date().toISOString()});
}
export function partnerImages(db:Store,ids:any){
 if(!Array.isArray(ids)||ids.length>4||ids.some(id=>typeof id!=='string'))throw Error('每次最多上传 4 张图片');
 const images=[...new Set(ids)].map(id=>{const a=db.get(id);if(a?.kind!=='partnerImage'||!/^\w+-image-[a-f0-9]{64}$/.test(a.id)||!/^\w+\/\w+$/.test(a.mime))throw Error('学习伙伴图片不存在');return a;});
 return {images,data:images.map(a=>'data:'+a.mime+';base64,'+readFileSync(join(db.dir,'files',a.hash)).toString('base64'))};
}
