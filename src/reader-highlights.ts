export function markReaderText(layer:HTMLElement,quotes:string[]){
 const spans=Array.from(layer.querySelectorAll<HTMLElement>('span')).filter(s=>s.firstChild?.nodeType===Node.TEXT_NODE);
 for(const s of spans)s.classList.remove('saved-pdf-highlight');
 const norm=(s:string)=>s.replace(/\s/g,'');let whole='',parts:{span:HTMLElement;start:number;end:number}[]=[];
 for(const span of spans){const start=whole.length;whole+=norm(span.textContent||'');parts.push({span,start,end:whole.length});}
 for(const quote of quotes){const q=norm(quote);if(!q)continue;let at=whole.indexOf(q);while(at>=0){for(const p of parts)if(p.start<at+q.length&&p.end>at)p.span.classList.add('saved-pdf-highlight');at=whole.indexOf(q,at+q.length);}}
 return spans.filter(s=>s.classList.contains('saved-pdf-highlight')).length;
}
