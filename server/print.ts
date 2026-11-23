import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {normalizeMathMarkdown,rehypeReadableMath,rehypeMathBlocks,MATH_STYLES} from '../shared/math-layout';
function paperBlocks(){return (tree:any)=>{const result:any[]=[];let section:any=null;for(const node of tree.children||[]){const label=(node.children||[]).map((c:any)=>c.value||'').join('');if(node.tagName==='h2'&&/^第 \d+ 题 · ZX-/.test(label)){section={type:'element',tagName:'section',properties:{className:['paper-question']},children:[]};result.push(section);}if(section)section.children.push(node);else result.push(node);}tree.children=result;};}
export function printHtml(content:string){
 const base=dirname(require.resolve('katex/package.json'));
 const css=readFileSync(join(base,'dist/katex.min.css'),'utf8').replace(/url\((?:["']?)(fonts\/[^)'"\s]+)(?:["']?)\)/g,(_m,file)=>'url(data:font/'+(file.endsWith('woff2')?'woff2':file.endsWith('woff')?'woff':'ttf')+';base64,'+readFileSync(join(base,'dist',file)).toString('base64')+')');
 const normalized=normalizeMathMarkdown(content);
 const rendered=renderToStaticMarkup(React.createElement(ReactMarkdown,{remarkPlugins:[remarkMath],rehypePlugins:[rehypeReadableMath,rehypeKatex,rehypeMathBlocks,paperBlocks],components:{p:({children}:any)=>{const value=typeof children==='string'?children:'';const match=value.match(/^ZX-ANSWER-SPACE-(\d+)$/);return match?React.createElement('div',{className:'answer-space',style:{height:Math.min(24,Math.max(3,Number(match[1])))*8+'mm'},'aria-label':'作答留白'}):React.createElement('p',null,children);}}},normalized));
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><style>${css}\n${MATH_STYLES}
 @page{size:A4;margin:18mm}body{margin:0;font-family:'Microsoft YaHei',sans-serif;color:#183b31}
 .print-page{width:174mm;margin:0 auto;font-size:12pt;line-height:2}
 h1{font-size:21pt;line-height:1.5;border-bottom:2px solid #16796f;padding-bottom:14px;margin:0 0 28px}
 h2{font-size:16pt}h3{font-size:13pt}h4{font-size:12pt}img{display:none}pre{white-space:pre-wrap}
 .paper-question{break-inside:avoid;page-break-inside:avoid}
 .answer-space{margin:6mm 0 9mm;break-inside:avoid;background:repeating-linear-gradient(to bottom,transparent 0,transparent calc(8mm - 1px),#d6dfda calc(8mm - 1px),#d6dfda 8mm)}
 @media print{.print-page{width:auto;margin:0}}
 </style><body><main class="math-content print-page">${rendered}</main></body></html>`;
}
