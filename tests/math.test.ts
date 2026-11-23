import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMathMarkdown,readableMath,MATH_STYLES} from '../shared/math-layout';
import {printHtml} from '../server/print';
import {GUARD} from '../server/ai';
import {createRequire} from 'node:module';
test('KaTeX renderer and bundled font/CSS versions match',()=>{
 const rendererRequire=createRequire(require.resolve('rehype-katex'));
 assert.equal(require('katex/package.json').version,rendererRequire('katex/package.json').version);
});
test('unambiguous simple divisions and inline fractions use full stacked fractions',()=>{
 assert.equal(readableMath('1/2'),String.raw`\dfrac{1}{2}`);
 assert.equal(readableMath('(x+1)/(x-1)'),String.raw`\dfrac{x+1}{x-1}`);
 assert.equal(readableMath(String.raw`\frac{1}{\tfrac{x}{2}}`),String.raw`\dfrac{1}{\dfrac{x}{2}}`);
 assert.equal(readableMath('a/b+c'),'a/b+c');
 assert.equal(readableMath('https://example.org'),'https://example.org');
});
test('LaTeX delimiters normalize without altering fenced and inline code',()=>{
 assert.equal(normalizeMathMarkdown(String.raw`\(x+1\)`),'$x+1$');
 assert.match(normalizeMathMarkdown(String.raw`\[\sqrt{x+1}\]`),/\n\n\$\$\n/);
 const code='```text\n\\[not math\\]\n```\n`\\(not math\\)`';
 assert.equal(normalizeMathMarkdown(code),code);
});
test('print renders readable blocks, complete radicals and no math parse errors',()=>{
 const html=printHtml(String.raw`计算 $1/2$ 与 $\sqrt{1+\frac{1}{x+1}}$。`);
 assert.equal((html.match(/class="mfrac"/g)||[]).length,2);
 assert.equal((html.match(/class="math-block"/g)||[]).length,2);
 assert.ok(html.includes('<msqrt>'));
 assert.ok(html.includes('sqrt'));
 assert.ok(!html.includes('class="katex-error"'));
 assert.match(html,/class="math-content print-page"/);
});
test('layout gives equations vertical padding and protects print formulas from page splits',()=>{
 assert.match(MATH_STYLES,/margin:24px 0;padding:16px 12px/);
 assert.match(MATH_STYLES,/break-inside:avoid/);
 assert.match(MATH_STYLES,/font-size:12pt;line-height:2/);
});
test('math instructions are included in the model system prompt and preserve radical scope',()=>{
 assert.ok(GUARD.includes(String.raw`\dfrac{完整分子}{完整分母}`));
 assert.ok(GUARD.includes(String.raw`\sqrt{完整被开方表达式}`));
 assert.ok(GUARD.includes('范围不明时标记待确认'));
});
test('powers use semantic superscripts with the complete exponent in screen/print math',()=>{
 assert.equal(readableMath(String.raw`x^{\dfrac{1}{2}}+\frac{1}{2}`),String.raw`x^{\frac{1}{2}}+\dfrac{1}{2}`);
 assert.equal(readableMath(String.raw`x^{1+\frac{a}{b^{\frac{1}{2}}}}`),String.raw`x^{1+\frac{a}{b^{\frac{1}{2}}}}`);
 const html=printHtml(String.raw`$x^{12}$、$e^{-x}$、$(a+b)^{n+1}$、$x^{\frac{1}{2}}$`);
 assert.equal((html.match(/<msup>/g)||[]).length,4);
 assert.ok(html.includes('<mn>12</mn>'));
 assert.ok(html.includes('<mi>n</mi><mo>+</mo><mn>1</mn>'));
 assert.ok(!html.includes('class="katex-error"'));
 assert.ok(GUARD.includes('右上角的上标'));assert.ok(GUARD.includes('^{完整指数}'));
 assert.ok(GUARD.includes('代码中的幂运算语法保持原样'));
 const code='```python\nx**2\n```\n`x^12`';assert.equal(normalizeMathMarkdown(code),code);
});
