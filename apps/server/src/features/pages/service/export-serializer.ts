/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Serializes exact authored Page versions with bounded safe export links.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Serializes exact authored Page versions with bounded safe export links.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { MAX_EXPORT_BYTES } from '@study/contracts/exports';
import type { exportOmissionSchema } from '@study/contracts/exports';
import type { PageVersion } from '@study/contracts/pages/types';
import type { blockSchema, Inline } from '@study/contracts/sources/schemas';

import { exportBudget } from '#server/platform/content-export/budget';

const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

export function safeExportLink(s: string): boolean {
  if (
    Array.from(s).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
    )
  )
    return false;

  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

const markdownText = (s: string) => s.replace(/[\\`*_{}[\]()<>#+.!|~-]/g, '\\$&');

const fenceLength = (text: string, pattern: RegExp) => {
  let length = 3;

  for (const match of text.matchAll(pattern)) length = Math.max(length, match[0].length + 1);

  return length;
};

function markedMarkdown(text: string) {
  return Array.from(text, (character) =>
    /[\\`*_{}[\]()<>#+.!|~&-]/.test(character)
      ? '&#' + character.codePointAt(0) + ';'
      : escapeHtml(character)
  ).join('');
}

export function serializePageVersion(version: PageVersion, format: 'markdown' | 'html') {
  const document = version.document;
  const citations = version.citations;

  exportBudget().consume(version);
  const omissions: (typeof exportOmissionSchema.Type)[] = [];
  const html = format === 'html';

  function inline(items: readonly Inline[], asHtml = html): string {
    const esc = asHtml ? escapeHtml : markdownText;

    return items
      .map((item) => {
        if (item.type === 'break') return asHtml ? '<br>' : '  \n';

        if (item.type === 'math') {
          omissions.push({ code: 'math_not_rendered' });

          return asHtml
            ? '<code>' + escapeHtml(item.text) + '</code>'
            : '$' + markdownText(item.text) + '$';
        }

        let text = esc(item.text);

        if (item.type === 'link') {
          text = markedText(
            { type: 'text', text: item.text, marks: item.marks ?? [] },
            text,
            asHtml
          );

          if (!safeExportLink(item.href)) {
            omissions.push({ code: 'unsafe_link' });

            return text;
          }

          return asHtml
            ? '<a href="' + escapeHtml(item.href) + '">' + text + '</a>'
            : '[' +
                text +
                '](' +
                item.href.replace(/[()<>"'\\]/g, (c) => '%' + c.charCodeAt(0).toString(16)) +
                ')';
        }

        text = markedText(item, text, asHtml);

        return text;
      })
      .join('');
  }

  function markedText(item: Extract<Inline, { type: 'text' }>, text: string, asHtml: boolean) {
    for (const mark of item.marks) {
      const tags = {
        strong: 'strong',
        emphasis: 'em',
        code: 'code',
        strike: 's',
        subscript: 'sub',
        superscript: 'sup'
      };

      if (!asHtml && mark === item.marks[0]) text = markedMarkdown(item.text);

      text = '<' + tags[mark] + '>' + text + '</' + tags[mark] + '>';
    }

    return text;
  }

  function inlineBlock(block: typeof blockSchema.Type) {
    const c = block.content;
    let out: string;

    switch (c.type) {
      case 'paragraph':
      case 'segment':
        out = html ? '<p>' + inline(c.inlines) + '</p>' : inline(c.inlines);
        break;
      case 'heading':
        out = html
          ? '<h' + c.level + '>' + inline(c.inlines) + '</h' + c.level + '>'
          : '#'.repeat(c.level) + ' ' + inline(c.inlines);
        break;
      case 'reference':
        out = inline(c.inlines);

        if (safeExportLink(c.href))
          out += html
            ? ' <a href="' + escapeHtml(c.href) + '">' + escapeHtml(c.href) + '</a>'
            : ' (' + markdownText(c.href) + ')';
        else omissions.push({ code: 'unsafe_link', blockId: block.id });

        break;
      default:
        throw new StudyError('internal', 'Expected inline export block');
    }

    return out;
  }

  function literalBlock(block: typeof blockSchema.Type) {
    const c = block.content;
    let out: string;

    switch (c.type) {
      case 'code': {
        const fence = '`'.repeat(fenceLength(c.code, /`+/g));

        out = html
          ? '<pre><code>' + escapeHtml(c.code) + '</code></pre>'
          : fence + '\n' + c.code + '\n' + fence;
        break;
      }
      case 'math':
        omissions.push({ code: 'math_not_rendered', blockId: block.id });
        out = html
          ? '<pre>' + escapeHtml(c.expression) + '</pre>'
          : '$$\n' + markdownText(c.expression) + '\n$$';
        break;
      case 'image':
        omissions.push({ code: 'image_not_embedded', blockId: block.id });
        out = html ? '<p>' + escapeHtml(c.alt) + '</p>' : markdownText(c.alt);
        break;
      default:
        throw new StudyError('internal', 'Expected literal export block');
    }

    return out;
  }

  function tableParagraph(items: readonly Inline[]) {
    return '<p>' + inline(items, true) + '</p>';
  }

  function section(blockId: string, content: string) {
    return html ? '<section id="' + escapeHtml(blockId) + '">' + content + '</section>' : content;
  }

  omissions.push({ code: 'metadata_sidecar' }, { code: 'source_fidelity' });
  let body = document.blocks
    .map((block) => {
      const c = block.content;
      let out: string;

      switch (c.type) {
        case 'paragraph':
        case 'segment':
        case 'heading':
        case 'reference':
          out = inlineBlock(block);
          break;
        case 'code':
        case 'math':
        case 'image':
          out = literalBlock(block);
          break;
        case 'list_item':
          // Explicit labels retain independent restarts and wide-marker nested items.
          out = c.items
            .map(
              (item) =>
                '<div style="margin-left:' +
                item.depth * 2 +
                'em" data-continuation="' +
                !!item.continuation +
                '">' +
                (item.continuation ? '' : item.ordered ? item.start + '. ' : '• ') +
                inline(item.inlines, true) +
                '</div>'
            )
            .join('\n');
          break;
        case 'table':
          out =
            '<table>' +
            c.rows
              .map(
                (r) =>
                  '<tr>' +
                  r.cells
                    .map((cell) => {
                      const tag = cell.header ? 'th' : 'td';

                      return (
                        '<' +
                        tag +
                        (cell.colspan ? ` colspan="${cell.colspan}"` : '') +
                        (cell.rowspan ? ` rowspan="${cell.rowspan}"` : '') +
                        '>' +
                        cell.paragraphs.map(tableParagraph).join('') +
                        '</' +
                        tag +
                        '>'
                      );
                    })
                    .join('') +
                  '</tr>'
              )
              .join('') +
            '</table>';
          break;
      }

      return section(block.id, out);
    })
    .join('\n\n');
  // Canonical metadata retains anchored text, citations and evidence without executable markup.
  const metadata = json({ version, document, citations }).replaceAll('<', '\\u003c');

  body = html
    ? '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><title>' +
      escapeHtml(String(version.id)) +
      '</title></head><body>' +
      body +
      '<pre data-study-metadata="1">' +
      escapeHtml(metadata) +
      '</pre></body></html>'
    : body +
      '\n\n' +
      '~'.repeat(fenceLength(metadata, /~+/g)) +
      'json\n' +
      metadata +
      '\n' +
      '~'.repeat(fenceLength(metadata, /~+/g));
  const bytes = new TextEncoder().encode(body);

  if (bytes.length > MAX_EXPORT_BYTES)
    throw new StudyError('invalid_input', 'Export exceeds byte limit');

  return {
    versionId: version.id,
    format,
    filename: `page-${version.id}.${html ? 'html' : 'md'}`,
    mediaType: html
      ? ('text/html; charset=utf-8' as const)
      : ('text/markdown; charset=utf-8' as const),
    bytes,
    omissions
  };
}
