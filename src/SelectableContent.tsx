import React, {useEffect, useRef, useState} from "react";
import {overlaps, selectionRect, type Rect, type SelectionSource, type AskSelection} from "../shared/selection";

const rectOf = (r: DOMRect): Rect => ({x:r.left,y:r.top,w:r.width,h:r.height});
// Use semantic math once, not KaTeX's duplicate MathML and visual text layers.
export function extractSelection(root: HTMLElement, area?: Rect, range?: Range): string {
  const output: string[] = [];
  let length = 0;
  const hit = (r: DOMRect) => area ? overlaps(area,rectOf(r)) : r.width > 0 && r.height > 0;
  function visit(node: Node) {
    if (length >= 6000) return;
    if (range && !range.intersectsNode(node)) return;
    if (node instanceof HTMLElement) {
      if (node.matches("button,script,style,[aria-hidden=true]")) return;
      if (node.classList.contains("katex")) {
        const visual = node.querySelector(".katex-html") || node;
        const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        if (tex && tex.length+length+4<=6000 && [...visual.getClientRects()].some(hit)) {output.push(" $"+tex+"$ ");length+=tex.length+4;}
        return;
      }
      if (/^(P|DIV|LI|H[1-6]|TR|BR|PRE)$/.test(node.tagName)) output.push("\n");
      for (const child of node.childNodes) visit(child);
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const text = node.textContent;
      const probe = document.createRange();probe.selectNodeContents(node);
      if (![...probe.getClientRects()].some(hit)) return;
      const start = range?.startContainer === node ? range.startOffset : 0;
      const end = range?.endContainer === node ? range.endOffset : text.length;
      let found = "";
      for (let i=start;i<end && length+found.length<6000;) {
        // Skip off-screen/non-intersecting chunks before expensive character ranges.
        if(area){
          let chunkEnd=Math.min(end,i+128);
          if(chunkEnd<end && text.charCodeAt(chunkEnd)>=0xdc00 && text.charCodeAt(chunkEnd)<=0xdfff)chunkEnd++;
          probe.setStart(node,i);probe.setEnd(node,chunkEnd);
          if(![...probe.getClientRects()].some(hit)){i=chunkEnd;continue;}
        }
        const next = i + ((text.codePointAt(i) || 0) > 0xffff ? 2 : 1);
        probe.setStart(node,i);probe.setEnd(node,next);
        if ([...probe.getClientRects()].some(hit)) found+=text.slice(i,next);
        i=next;
      }
      output.push(found);length+=found.length;
    }
  }
  visit(root);
  return output.join("").replace(/\n{3,}/g,"\n\n").trim().slice(0,6000);
}
export function SelectableContent({source,label,children}:{source:SelectionSource;label:string;children:React.ReactNode}) {
  const root=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null);
  const [mode,setMode]=useState(false),[box,setBox]=useState<Rect|null>(null),[excerpt,setExcerpt]=useState("");
  const reset=()=>{start.current=null;setBox(null);setExcerpt("");};
  useEffect(()=>{reset();setMode(false);},[source.id,source.version,source.courseId,source.examId]);
  function textSelection() {
    if(mode || !root.current)return;
    const s=window.getSelection();
    if(!s?.rangeCount || s.isCollapsed || !root.current.contains(s.anchorNode) || !root.current.contains(s.focusNode))return;
    setExcerpt(extractSelection(root.current,undefined,s.getRangeAt(0)));setBox(null);
  }
  function point(e:React.PointerEvent) {
    const r=root.current!.getBoundingClientRect();
    return {x:Math.max(0,Math.min(r.width,e.clientX-r.left)),y:Math.max(0,Math.min(r.height,e.clientY-r.top))};
  }
  return <section className="selectable-content" data-source-id={source.id}>
    <div className="selection-toolbar"><button type="button" className="ghost small" aria-pressed={mode} onClick={()=>{reset();setMode(!mode);window.getSelection()?.removeAllRanges();}}>{mode?"退出框选":"框选内容"}</button><small>{mode?"拖动框选；公式会保留完整分式与根式。":"也可直接选中文字后提问。"}</small></div>
    <div ref={root} className={"selection-surface"+(mode?" is-selecting":"")} onMouseUp={textSelection} onTouchEnd={()=>setTimeout(textSelection,0)}
      onPointerDown={e=>{if(!mode || e.button!==0)return;e.preventDefault();start.current=point(e);setBox(null);setExcerpt("");e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(start.current)setBox(selectionRect(start.current,point(e)));}}
      onPointerCancel={reset} onLostPointerCapture={()=>{start.current=null;}}
      onPointerUp={e=>{if(!start.current || !root.current)return;const area=selectionRect(start.current,point(e));start.current=null;if(area.w<4||area.h<4){reset();return;}setBox(area);const r=root.current.getBoundingClientRect();setExcerpt(extractSelection(root.current,{...area,x:r.left+area.x,y:r.top+area.y}));}}
      onClickCapture={e=>{if(mode){e.preventDefault();e.stopPropagation();}}}>
      {children}{box&&<div className="selection-box" aria-hidden="true" style={{left:box.x,top:box.y,width:box.w,height:box.h}}/>}
    </div>
    {excerpt&&<div className="selection-preview"><small>{label} · 已选内容</small><pre>{excerpt}</pre><div className="toolbar"><button type="button" className="small" onClick={()=>{const detail:AskSelection={source,label,excerpt,region:box||undefined};window.dispatchEvent(new CustomEvent("study-selection",{detail}));}}>就此选区提问</button><button type="button" className="ghost small" onClick={reset}>清除选区</button></div></div>}
    {box&&!start.current&&!excerpt&&<p className="hint">选区内没有文字或公式，请重新框选内容。</p>}
  </section>;
}
