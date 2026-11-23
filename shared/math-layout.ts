// Shared presentation rules: the stored question/answer text is never rewritten.
export function normalizeMathMarkdown(source: string): string {
  const code = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1|(`+)[^\n]*?\2/g;
  const normalize = (s: string) => s
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex) => '\n\n$$\n' + tex.trim() + '\n$$\n\n')
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, tex) => '$' + tex + '$');
  let result = '', cursor = 0;
  for (const match of source.matchAll(code)) {
    result += normalize(source.slice(cursor, match.index)) + match[0];
    cursor = match.index! + match[0].length;
  }
  return result + normalize(source.slice(cursor));
}
export function readableMath(tex: string): string {
  // A forced display-size fraction inside a power can dip back to the baseline.
  // Keep it stacked, but let TeX use script sizing for the complete exponent.
  let result = '', pendingPower = false;
  const groups:boolean[]=[];
  for(let i=0;i<tex.length;){
    const ch=tex[i];
    if(ch==='\\'){
      const token=tex.slice(i).match(/^\\[A-Za-z]+|^\\./)?.[0]||ch;
      result+=/^\\(?:dfrac|tfrac|frac)$/.test(token)?(groups.at(-1)?'\\frac':'\\dfrac'):token;
      pendingPower=false;i+=token.length;continue;
    }
    if(ch==='{'){groups.push(!!groups.at(-1)||pendingPower);pendingPower=false;}
    else if(ch==='}'){groups.pop();pendingPower=false;}
    else if(ch==='^')pendingPower=true;
    else if(!/\s/.test(ch))pendingPower=false;
    result+=ch;i++;
  }
  // Convert only an unambiguous whole fraction. Do not reinterpret a/b+c,
  // URLs, source code, units, or any text outside math delimiters.
  const atom = String.raw`(?:[+-]?\d+(?:\.\d+)?|[A-Za-z](?:\^(?:\d+|\{[A-Za-z0-9]+\}))?|\([^()\/]+\)|\{[^{}\/]+\})`;
  const match = result.trim().match(new RegExp('^(' + atom + ')\\s*/\\s*(' + atom + ')$'));
  const ungroup = (s: string) => /^[({]/.test(s) ? s.slice(1, -1) : s;
  if (match) result = '\\dfrac{' + ungroup(match[1]) + '}{' + ungroup(match[2]) + '}';
  return result;
}
const classes = (n: any): string[] => Array.isArray(n.properties?.className) ? n.properties.className : [];
export function rehypeReadableMath() {
  return (tree: any) => {
    function visit(node: any) {
      if (node.type === 'element' && node.tagName === 'code' && classes(node).some(c => ['math-inline','math-display','language-math'].includes(c))) {
        const tex = readableMath(node.children.map((c: any) => c.value || '').join(''));
        node.children = [{ type: 'text', value: tex }];
        if (/\\(?:dfrac|sqrt|begin|sum|prod|int)\b/.test(tex) || tex.length > 70)
          node.properties.className = [...classes(node).filter(c => c !== 'math-inline'), 'math-display'];
      } else for (const child of node.children || []) visit(child);
    }
    visit(tree);
  };
}
export function rehypeMathBlocks() {
  return (tree: any) => {
    function visit(node: any) {
      if (!node.children) return;
      node.children = node.children.map((child: any) => {
        if (child.type === 'element' && classes(child).includes('katex-display'))
          return { type: 'element', tagName: 'span', properties: { className: ['math-block'] }, children: [child] };
        visit(child); return child;
      });
    }
    visit(tree);
  };
}
export const MATH_STYLES = `
.math-content{font-size:16px;line-height:2.05;overflow-wrap:anywhere;min-width:0}
.math-content p{margin:1em 0;orphans:3;widows:3}
.math-content h2{margin:2.1em 0 .9em;break-after:avoid}
.math-content h3{margin:1.7em 0 .8em;break-after:avoid}
.math-content h4{margin:1.5em 0 .7em;break-after:avoid}
.math-content li{margin:.85em 0;padding-left:.25em}
.math-content .katex{font-size:1.12em;overflow-wrap:normal}
.math-content .math-block{display:block;box-sizing:border-box;max-width:100%;margin:24px 0;padding:16px 12px;overflow-x:auto;overflow-y:hidden;break-inside:avoid;page-break-inside:avoid}
.math-content .math-block .katex-display{display:block;margin:0;padding:6px 2px;text-align:left;overflow:visible}
.math-content .math-block .katex-display>.katex{display:inline-block;white-space:nowrap;text-align:left}
.math-content hr{border:0;border-top:1px solid #dce5e1;margin:36px 0}
.math-content pre{overflow:auto;line-height:1.7}
.math-content table{border-collapse:collapse}
.math-content td,.math-content th{padding:12px;border:1px solid #dce5e1}
.math-content .katex-error{white-space:pre-wrap;overflow-wrap:anywhere}
@media print{
 .math-content{font-size:12pt;line-height:2}
 .math-content .math-block{overflow:visible;margin:6mm 0;padding:3mm 1mm;break-inside:avoid}
 .math-content h1,.math-content h2,.math-content h3,.math-content h4{break-after:avoid}
 .math-content p:has(.math-block){break-inside:avoid}
}
`;
