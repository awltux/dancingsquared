// Markdown -> HTML for the online edition.
//
// Only the subset this book uses, which is a feature rather than a limitation: the converter and
// the book are written together, so nothing has to be guessed. The one thing it must get right is
// ANCHORS -- the book is built on internal links, so heading ids are generated with the same
// algorithm the link gate uses, or every cross-reference lands nowhere.

/** Heading id, matching the anchors `check-links.mjs` validates. */
export function anchorOf(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// THE HTML RULE IS THE BOOK'S SHARED ONE (`lib/escape.mjs`); this file carried a byte-identical copy of it.
import { escapeHtml } from './escape.mjs';

/** A .md link becomes a .html one; everything else is left alone. */
export function rewriteHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [path, frag] = href.split('#');
  const html = path.replace(/\.md$/, '.html');
  return frag ? `${html}#${frag}` : html;
}

/** Inline Markdown (bold, italic, code, links, images) to HTML. */
export function inline(text) {
  // IMAGES BEFORE LINKS, and that order is the whole trick: `![alt](src)` CONTAINS `[alt](src)`, so
  // matching links first turns an inline image into a link with a stray `!` in front of it. Both take
  // the same placeholder route, so the two passes share one list.
  //
  // AN IMAGE IN THE MIDDLE OF A SENTENCE is what this is for. A paragraph that is nothing but an image
  // is a figure, and the block parser takes that case first; this is for the ones that are inline --
  // the nav bar's own icons, shown in a table describing the bar, where a picture of the button is
  // worth more than a name for it.
  const links = [];
  let s = String(text).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    links.push(`<img src="${escapeHtml(rewriteHref(src))}" alt="${escapeHtml(alt)}" loading="lazy">`);
    return `\u0001${links.length - 1}\u0001`;
  });

  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    const target = rewriteHref(href);
    const external = /^https?:/.test(target);
    // AN EXTERNAL LINK OPENS IN A NEW TAB, and that is not a preference: the site is installable and
    // is meant to be read in its own window, where there is no back button to return from GitHub
    // Issues with. `rel="noopener"` was already being written here, which only means anything
    // alongside the target this adds.
    links.push(
      `<a href="${escapeHtml(target)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(label)}</a>`,
    );
    return `\u0001${links.length - 1}\u0001`;
  });

  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Strikethrough marks a DISABLED navigation direction in the Markdown; carrying it through as
  // <del> lets the site builder style it as a greyed-out button rather than a live link.
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[Number(i)] ?? '');
}

/** Parse the book's Markdown into block objects. */
export function parseBlocks(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lines: code });
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line.trim());
    if (img) {
      blocks.push({ type: 'image', alt: img[1], src: img[2] });
      i++;
      continue;
    }
    const comment = /^<!--(.*)-->\s*$/.exec(line.trim());
    if (comment) {
      i++; // figure metadata and generated-file markers are notes to the tools, not to a reader
      continue;
    }
    if (/^\|/.test(line.trim())) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) rows.push(lines[i++]);
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      blocks.push({
        type: 'table',
        header: cells(rows[0]),
        rows: rows.slice(1).filter((r) => !/^\|[\s:|-]+\|$/.test(r.trim())).map(cells),
      });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      // A CALLOUT, marked `> [!WARNING]` on the quote's first line. The accent bar on a plain quote is
      // this book's mark for CALLERLAB's own words, so a passage the book is saying in its OWN voice
      // has to be a different thing -- a warning that wore the quotation's styling would read as
      // something the manual said. The marker line is dropped; the type becomes a CSS class.
      const alert = /^\[!([A-Za-z]+)\]\s*$/.exec((quote[0] ?? '').trim());
      if (alert) quote.shift();
      blocks.push({ type: 'quote', lines: quote, alert: alert ? alert[1].toLowerCase() : null });
      continue;
    }
    const listMatch = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items = [];
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        let text = m[2];
        i++;
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^#/.test(lines[i]) && !/^\|/.test(lines[i]) && !/^>/.test(lines[i]) && !/^```/.test(lines[i])) {
          text += ` ${lines[i].trim()}`;
          i++;
        }
        items.push(text.trim());
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const para = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\|/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !/^!\[/.test(lines[i].trim()) &&
      !/^<!--/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

/**
 * Render blocks to HTML.
 *
 * `onFigureSection` is called for each `### Figure` heading with the paragraph that follows it, so
 * the site builder can put the ANIMATION ahead of the static boards without this module having to
 * know anything about animations.
 */
export function render(blocks, { figures = true, onFigureHeading = null, figureId = null } = {}) {
  const out = [];
  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      const level = Math.min(6, block.level);
      out.push(`<h${level} id="${anchorOf(block.text)}">${inline(block.text)}</h${level}>`);
      if (block.level === 3 && /^(Figure|Animation)$/i.test(block.text.trim()) && onFigureHeading && figureId) {
        out.push(onFigureHeading(figureId));
      }
      return;
    }
    if (block.type === 'paragraph') {
      out.push(`<p>${inline(block.text)}</p>`);
      return;
    }
    if (block.type === 'quote') {
      // A CALLOUT IS THE BOOK'S OWN PROSE, so its wrapped lines reflow like prose and a blank `>`
      // starts a new paragraph. A plain quote is left line-by-line: the call pages stack a
      // teaching-unit line and the manual's quoted passages in ONE quote block, and joining them
      // would run the book's own words into CALLERLAB's.
      if (block.alert) {
        const paras = block.lines.join('\n').split(/\n\s*\n/);
        const html = paras
          .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim())
          .filter(Boolean)
          .map((p) => `<p>${inline(p)}</p>`)
          .join('');
        out.push(`<blockquote class="callout ${block.alert}">${html}</blockquote>`);
        return;
      }
      out.push(`<blockquote>${block.lines.map((l) => (l.trim() ? `<p>${inline(l)}</p>` : '')).join('')}</blockquote>`);
      return;
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${block.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      return;
    }
    if (block.type === 'code') {
      out.push(`<pre><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`);
      return;
    }
    if (block.type === 'hr') {
      out.push('<hr>');
      return;
    }
    if (block.type === 'table') {
      const head = block.header.map((h) => `<th>${inline(h)}</th>`).join('');
      const body = block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      return;
    }
    if (block.type === 'image') {
      if (!figures) return;
      const src = block.src.replace(/^\.\.\//, '../');
      out.push(
        `<figure><img src="${src}" alt="${escapeHtml(block.alt)}" loading="lazy"><figcaption>${inline(block.alt)}</figcaption></figure>`,
      );
      return;
    }
    void index;
  });
  return out.join('\n');
}
