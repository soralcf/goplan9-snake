'use strict';

// A small, dependency-free Markdown renderer for the workspace handbook.
// It intentionally supports only the subset used by docs/ASM-HANDBOOK.md:
// headings, paragraphs, fenced code, tables, flat lists, blockquotes,
// horizontal rules, inline code, bold, and links.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function plainText(value) {
  return String(value)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '');
}

function slugify(value) {
  const slug = plainText(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'section';
}

function uniqueId(base, usedIds) {
  const count = usedIds.get(base) || 0;
  usedIds.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function normalizeLocalPath(href, baseDir) {
  let raw = href.split('#')[0];
  try {
    raw = decodeURIComponent(raw);
  } catch (error) {
    // Keep the raw value if it is not valid percent-encoding.
  }
  const segments = [];
  const prefix = baseDir ? baseDir.split('/') : [];
  for (const segment of prefix.concat(raw.split('/'))) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function renderLink(label, href, options) {
  const rawHref = decodeEntities(href);
  if (rawHref.startsWith('#')) {
    return `<a href="${escapeAttribute(rawHref)}">${label}</a>`;
  }
  if (/^https?:\/\//i.test(rawHref)) {
    return `<a class="external" href="${escapeAttribute(rawHref)}">${label}</a>`;
  }
  if (/^(mailto|file|vscode|command):/i.test(rawHref)) {
    return label;
  }
  const local = normalizeLocalPath(rawHref, options.baseDir);
  if (!local) {
    return label;
  }
  return `<a class="local" href="#" data-file="${escapeAttribute(local)}">${label}</a>`;
}

function renderInline(value, options) {
  const codeSpans = [];
  let text = String(value).replace(/`([^`]+)`/g, (match, code) => {
    const token = `\u0000C${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = escapeHtml(text);
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (match, label, href) => renderLink(label, href, options)
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[(通用|arm64|darwin|amd64)\]/g, (match, label) => {
    const name = {
      通用: 'common',
      arm64: 'arm64',
      darwin: 'darwin',
      amd64: 'amd64',
    }[label];
    return `<span class="arch-tag arch-${name}">${label}</span>`;
  });
  text = text.replace(/\u0000C(\d+)\u0000/g, (match, index) => {
    return codeSpans[Number(index)] || '';
  });
  return text;
}

function isFence(line) {
  return /^```/.test(line);
}

function renderCodeBlock(lines, info) {
  const match = /^```+\s*([A-Za-z0-9_+.-]*)/.exec(info);
  const language = match && match[1] ? match[1] : 'text';
  const code = lines.join('\n');
  return `<pre data-lang="${escapeAttribute(language)}"><code class="language-${escapeAttribute(language)}">${escapeHtml(code)}</code></pre>`;
}

function isHorizontalRule(line) {
  return /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) {
    value = value.slice(1);
  }
  if (value.endsWith('|')) {
    value = value.slice(0, -1);
  }
  const cells = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (value[i] === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += value[i];
  }
  cells.push(current.trim());
  return cells;
}

function tableSeparator(line) {
  if (!line || !line.includes('|')) {
    return undefined;
  }
  const cells = splitTableRow(line);
  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) {
      return undefined;
    }
    if (cell.startsWith(':') && cell.endsWith(':')) {
      alignments.push('center');
    } else if (cell.endsWith(':')) {
      alignments.push('right');
    } else if (cell.startsWith(':')) {
      alignments.push('left');
    } else {
      alignments.push('');
    }
  }
  return alignments;
}

function isTableStart(lines, index) {
  return lineLooksLikeTable(lines[index]) && tableSeparator(lines[index + 1]) !== undefined;
}

function lineLooksLikeTable(line) {
  return typeof line === 'string' && line.includes('|');
}

function renderTable(lines, index, options) {
  const header = splitTableRow(lines[index]);
  const alignments = tableSeparator(lines[index + 1]) || [];
  let next = index + 2;
  const rows = [];
  while (
    next < lines.length &&
    lines[next].trim() !== '' &&
    lineLooksLikeTable(lines[next])
  ) {
    rows.push(splitTableRow(lines[next]));
    next++;
  }

  const cell = (tag, value, column) => {
    const alignment = alignments[column];
    const className = alignment ? ` class="align-${alignment}"` : '';
    return `<${tag}${className}>${renderInline(value, options)}</${tag}>`;
  };

  const headerHtml = header
    .map((value, column) => cell('th', value, column))
    .join('');
  const bodyHtml = rows
    .map((row) => {
      const cells = header.map((unused, column) => {
        return cell('td', row[column] === undefined ? '' : row[column], column);
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return {
    html: `<div class="table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
    next,
  };
}

function isListStart(line) {
  return /^\s*([-*+]|\d+\.)\s+/.test(line);
}

function renderList(lines, index, options) {
  const ordered = /^\s*\d+\.\s+/.test(lines[index]);
  const items = [];
  let next = index;
  while (next < lines.length) {
    const match = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[next]);
    if (!match) {
      break;
    }
    let text = match[2];
    next++;
    while (
      next < lines.length &&
      /^\s{2,}\S/.test(lines[next]) &&
      !isListStart(lines[next])
    ) {
      text += `\n${lines[next].trim()}`;
      next++;
    }
    items.push(text);
  }
  const tag = ordered ? 'ol' : 'ul';
  const body = items
    .map((item) => `<li>${renderInline(item, options)}</li>`)
    .join('');
  return { html: `<${tag}>${body}</${tag}>`, next };
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (isFence(line) || isHorizontalRule(line)) {
    return true;
  }
  if (/^(#{1,6})\s+/.test(line)) {
    return true;
  }
  if (isTableStart(lines, index)) {
    return true;
  }
  if (/^\s*>\s?/.test(line)) {
    return true;
  }
  return isListStart(line);
}

function renderBlocks(lines, options, usedIds) {
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index++;
      continue;
    }

    if (isFence(line)) {
      const info = line;
      const code = [];
      index++;
      while (index < lines.length && !isFence(lines[index])) {
        code.push(lines[index]);
        index++;
      }
      if (index < lines.length) {
        index++;
      }
      html.push(renderCodeBlock(code, info));
      continue;
    }

    if (isHorizontalRule(line)) {
      html.push('<hr>');
      index++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const id = uniqueId(slugify(text), usedIds);
      html.push(`<h${level} id="${escapeAttribute(id)}">${renderInline(text, options)}</h${level}>`);
      index++;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index, options);
      html.push(table.html);
      index = table.next;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index++;
      }
      html.push(`<blockquote>${renderBlocks(quote, options, usedIds)}</blockquote>`);
      continue;
    }

    if (isListStart(line)) {
      const list = renderList(lines, index, options);
      html.push(list.html);
      index = list.next;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !isBlockStart(lines, index)
    ) {
      paragraph.push(lines[index]);
      index++;
    }
    html.push(`<p>${renderInline(paragraph.join('\n'), options)}</p>`);
  }

  return html.join('\n');
}

function renderMarkdown(source, options = {}) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines, options, new Map());
}

module.exports = { renderMarkdown };
