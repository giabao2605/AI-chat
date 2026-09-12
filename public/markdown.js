function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function renderLink(label, href) {
  const safe = safeHttpUrl(href);
  if (!safe) return `${renderInline(label)} (${escapeHtml(href)})`;
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${renderInline(label)}</a>`;
}

function findUnescaped(text, needle, start) {
  let index = text.indexOf(needle, start);
  while (index !== -1) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0) return index;
    index = text.indexOf(needle, index + needle.length);
  }
  return -1;
}

function renderMath(delimiter, body, closing = delimiter) {
  const className = delimiter === '$$' || delimiter === '\\[' ? 'math-display' : 'math-inline';
  return `<span class="${className}">${escapeHtml(delimiter)}${escapeHtml(body)}${escapeHtml(closing)}</span>`;
}

function renderInline(value) {
  const text = String(value ?? '');
  let html = '';
  let index = 0;

  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        html += `<code>${escapeHtml(text.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith('\\(', index)) {
      const end = findUnescaped(text, '\\)', index + 2);
      if (end > index + 2) {
        html += renderMath('\\(', text.slice(index + 2, end), '\\)');
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith('\\[', index)) {
      const end = findUnescaped(text, '\\]', index + 2);
      if (end > index + 2) {
        html += renderMath('\\[', text.slice(index + 2, end), '\\]');
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith('$$', index)) {
      const end = findUnescaped(text, '$$', index + 2);
      if (end > index + 2) {
        html += renderMath('$$', text.slice(index + 2, end));
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '$') {
      const end = findUnescaped(text, '$', index + 1);
      const body = end > index + 1 ? text.slice(index + 1, end) : '';
      if (body && !/^\s|\s$/.test(body)) {
        html += renderMath('$', body);
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith('**', index) || text.startsWith('__', index)) {
      const marker = text.slice(index, index + 2);
      const end = text.indexOf(marker, index + 2);
      if (end > index + 2) {
        html += `<strong>${renderInline(text.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith('~~', index)) {
      const end = text.indexOf('~~', index + 2);
      if (end > index + 2) {
        html += `<del>${renderInline(text.slice(index + 2, end))}</del>`;
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '*' || text[index] === '_') {
      const marker = text[index];
      const end = text.indexOf(marker, index + 1);
      if (end > index + 1) {
        html += `<em>${renderInline(text.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }

    if (text[index] === '[') {
      const labelEnd = text.indexOf('](', index + 1);
      if (labelEnd > index + 1) {
        const hrefEnd = text.indexOf(')', labelEnd + 2);
        if (hrefEnd > labelEnd + 2) {
          html += renderLink(text.slice(index + 1, labelEnd), text.slice(labelEnd + 2, hrefEnd));
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    const urlMatch = text.slice(index).match(/^https?:\/\/[^\s<>]+/i);
    if (urlMatch) {
      let rawUrl = urlMatch[0];
      let suffix = '';
      while (/[.,;:!?]$/.test(rawUrl)) {
        suffix = rawUrl.slice(-1) + suffix;
        rawUrl = rawUrl.slice(0, -1);
      }
      const safe = safeHttpUrl(rawUrl);
      if (safe) {
        html += `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawUrl)}</a>${escapeHtml(suffix)}`;
        index += urlMatch[0].length;
        continue;
      }
    }

    if (text[index] === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      if (/^[\\`*_[\]{}()#+\-.!]$/.test(next)) {
        html += escapeHtml(next);
        index += 2;
        continue;
      }
      html += '\\';
      index += 1;
      continue;
    }

    html += escapeHtml(text[index]);
    index += 1;
  }

  return html;
}

function isFence(line) {
  return /^\s*```/.test(line);
}

function isHeading(line) {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function isQuote(line) {
  return /^\s{0,3}>\s?/.test(line);
}

function isUnorderedItem(line) {
  return /^\s{0,3}[-+*]\s+/.test(line);
}

function isOrderedItem(line) {
  return /^\s{0,3}\d+[.)]\s+/.test(line);
}

function isRule(line) {
  return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function mathBlockDelimiter(line) {
  const trimmed = String(line || '').trim();
  if (trimmed.startsWith('$$')) return { open: '$$', close: '$$' };
  if (trimmed.startsWith('\\[')) return { open: '\\[', close: '\\]' };
  return null;
}

function isMathBlockStart(line) {
  return Boolean(mathBlockDelimiter(line));
}

function splitTableRow(line) {
  let value = String(line || '').trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines, index) {
  return index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1]);
}

function isBlockStart(lines, index) {
  const line = lines[index] || '';
  return isFence(line)
    || isMathBlockStart(line)
    || isHeading(line)
    || isQuote(line)
    || isUnorderedItem(line)
    || isOrderedItem(line)
    || isRule(line)
    || isTableStart(lines, index);
}

function renderTable(lines, start) {
  const header = splitTableRow(lines[start]);
  const width = header.length;
  const rows = [];
  let index = start + 2;

  while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
    const cells = splitTableRow(lines[index]);
    rows.push(Array.from({ length: width }, (_, column) => cells[column] || ''));
    index += 1;
  }

  const headHtml = `<thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`;
  const bodyHtml = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return { html: `<table>${headHtml}${bodyHtml}</table>`, next: index };
}

function renderMathBlock(lines, start) {
  const delimiter = mathBlockDelimiter(lines[start]);
  if (!delimiter) return null;
  const first = lines[start].trim();
  const afterOpen = first.slice(delimiter.open.length);
  const sameLineEnd = afterOpen.lastIndexOf(delimiter.close);
  if (sameLineEnd >= 0) {
    const body = afterOpen.slice(0, sameLineEnd);
    return {
      html: `<div class="math-display">${escapeHtml(delimiter.open)}${escapeHtml(body)}${escapeHtml(delimiter.close)}</div>`,
      next: start + 1,
    };
  }

  const body = [afterOpen];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    const end = line.indexOf(delimiter.close);
    if (end >= 0) {
      body.push(line.slice(0, end));
      index += 1;
      return {
        html: `<div class="math-display">${escapeHtml(delimiter.open)}${escapeHtml(body.join('\n'))}${escapeHtml(delimiter.close)}</div>`,
        next: index,
      };
    }
    body.push(line);
    index += 1;
  }

  return {
    html: `<pre class="math-unclosed">${escapeHtml(lines.slice(start).join('\n'))}</pre>`,
    next: lines.length,
  };
}

export function markdownToSafeHtml(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isFence(line)) {
      const match = line.match(/^\s*```\s*([\w#+.-]*)/);
      const language = (match?.[1] || '').replace(/[^\w#+.-]/g, '').slice(0, 32);
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      blocks.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (isMathBlockStart(line)) {
      const math = renderMathBlock(lines, index);
      blocks.push(math.html);
      index = math.next;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.next;
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (isQuote(line)) {
      const quote = [];
      while (index < lines.length && isQuote(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map((item) => renderInline(item)).join('<br>')}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
    if (unordered) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s{0,3}[-+*]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${renderInline(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
    if (ordered) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s{0,3}\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${renderInline(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(renderInline(lines[index]));
      index += 1;
    }
    if (!paragraph.length) {
      paragraph.push(renderInline(line));
      index += 1;
    }
    blocks.push(`<p>${paragraph.join('<br>')}</p>`);
  }

  return blocks.join('');
}

export { escapeHtml, safeHttpUrl };
