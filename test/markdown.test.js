import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToSafeHtml } from '../public/markdown.js';

test('renders common AI markdown into structured HTML', () => {
  const html = markdownToSafeHtml(`Research hố đen có 4 hướng lớn:\n\n- **Quan sát:** ảnh chân trời sự kiện.\n- **Sóng hấp dẫn:** hợp nhất hố đen.\n\n> Chưa có đáp án hoàn chỉnh.\n\nDùng \`Page curve\` để mô tả.`);

  assert.match(html, /<p>Research hố đen có 4 hướng lớn:<\/p>/);
  assert.match(html, /<ul><li><strong>Quan sát:<\/strong> ảnh chân trời sự kiện\.<\/li>/);
  assert.match(html, /<li><strong>Sóng hấp dẫn:<\/strong> hợp nhất hố đen\.<\/li><\/ul>/);
  assert.match(html, /<blockquote>Chưa có đáp án hoàn chỉnh\.<\/blockquote>/);
  assert.match(html, /<code>Page curve<\/code>/);
});

test('renders headings, tables, code blocks and safe links', () => {
  const html = markdownToSafeHtml(`## Kết luận\n\n| Mục | Giá trị |\n| --- | --- |\n| A | **Tốt** |\n\n[OpenAI](https://openai.com/)\n\n\`\`\`js\nconst x = '<tag>';\n\`\`\``);

  assert.match(html, /<h2>Kết luận<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Mục<\/th>/);
  assert.match(html, /<td><strong>Tốt<\/strong><\/td>/);
  assert.match(html, /href="https:\/\/openai\.com\/"/);
  assert.match(html, /<pre><code class="language-js">const x = &#39;&lt;tag&gt;&#39;;<\/code><\/pre>/);
});

test('preserves inline TeX delimiters and markdown around math', () => {
  const html = markdownToSafeHtml('**Dũng hạng 2**: khoảng cách là \\(|2-6|=4\\), nên mệnh đề sai.');

  assert.match(html, /<strong>Dũng hạng 2<\/strong>/);
  assert.match(html, /<span class="math-inline">\\\(\|2-6\|=4\\\)<\/span>/);
  assert.doesNotMatch(html, /\\\*\\\*/);
});

test('preserves dollar and display TeX for MathJax', () => {
  const html = markdownToSafeHtml(`Công thức inline $x^2 + y^2 = z^2$.\n\n\\[\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n\\]`);

  assert.match(html, /<span class="math-inline">\$x\^2 \+ y\^2 = z\^2\$<\/span>/);
  assert.match(html, /<div class="math-display">\\\[/);
  assert.match(html, /\\sum_\{i=1\}\^\{n\} i = \\frac\{n\(n\+1\)\}\{2\}/);
  assert.match(html, /\\\]<\/div>/);
});

test('keeps TeX commands intact instead of swallowing backslashes', () => {
  const html = markdownToSafeHtml('Giá trị là \\(\\sqrt{2} + \\alpha\\).');
  assert.match(html, /\\sqrt\{2\}/);
  assert.match(html, /\\alpha/);
});

test('escapes raw HTML and never creates javascript links', () => {
  const html = markdownToSafeHtml(`<img src=x onerror="alert(1)">\n\n[click](javascript:alert(1))`);

  assert.doesNotMatch(html, /<img\b/i);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /click \(javascript:alert\(1\)\)/);
});

test('plain source URLs become safe clickable links', () => {
  const html = markdownToSafeHtml('Nguồn: https://example.com/report?id=7.');
  assert.match(html, /href="https:\/\/example\.com\/report\?id=7"/);
  assert.match(html, />https:\/\/example\.com\/report\?id=7<\/a>\.<\/p>/);
});
