/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ Serializes exact retained versions into bounded editable document and aid exports.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Escapes document content and emits typed omission metadata.                            │
 * │ - Encodes canonical aid identities and neutralizes CSV formula prefixes.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Serializers consume retained data only and never fetch images or execute diagrams.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialAidExportSchema } from '@study/contracts/materials/export';
import { MAX_EXPORT_BYTES } from '@study/contracts/materials/export';
import type { exportFormatSchema, exportOmissionSchema } from '@study/contracts/materials/export';
import type {
  materialCitationSchema,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import type { documentSchema, Inline } from '@study/contracts/sources/schemas';
/** Exact retained content serializers. HTML is an editable document, never DOCX or PDF. */
import { Schema } from 'effect';

import { exportBudget } from '../export-budget.ts';

const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
export function safeExportLink(s: string): boolean {
  if (/[\u0000-\u0020\u007f]/.test(s)) return false;
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
const csvCell = (s: string) =>
  '"' + (/^(?:\s*[=+@-]|[\t\r\n])/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';

export function serializeMaterialVersion(
  version: MaterialVersionDetailDto,
  format: typeof exportFormatSchema.Type,
  document: typeof documentSchema.Type | null,
  citations: readonly (typeof materialCitationSchema.Type)[] = []
) {
  exportBudget().consume({ version, document, citations });
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
        for (const mark of item.marks) {
          const tags = {
            strong: 'strong',
            emphasis: 'em',
            code: 'code',
            strike: 's',
            subscript: 'sub',
            superscript: 'sup'
          };
          if (asHtml) text = '<' + tags[mark] + '>' + text + '</' + tags[mark] + '>';
          else {
            if (mark === item.marks[0])
              text = Array.from(item.text, (character) =>
                /[\\`*_{}[\]()<>#+.!|~&-]/.test(character)
                  ? '&#' + character.codePointAt(0) + ';'
                  : escapeHtml(character)
              ).join('');
            text = '<' + tags[mark] + '>' + text + '</' + tags[mark] + '>';
          }
        }
        return text;
      })
      .join('');
  }
  let body: string;
  if (format === 'aid_json') {
    if (!['quiz', 'flashcards', 'diagram'].includes(version.kind))
      throw new StudyError('unsupported', 'Typed aid export requires an aid');
    body = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(materialAidExportSchema)))({
      schemaVersion: 1,
      version,
      citations
    });
  } else if (format === 'csv') {
    const content = version.content;
    let rows: string[][];
    if (content.kind === 'flashcards')
      rows = [
        ['cardId', 'front', 'back'],
        ...content.cards.map((c) => [String(c.cardId), c.front, c.back])
      ];
    else if (content.kind === 'quiz')
      rows = [
        ['questionId', 'kind', 'prompt', 'explanation', 'answer'],
        ...content.questions.map((q) => [
          String(q.id),
          q.kind,
          q.prompt,
          q.explanation,
          q.kind === 'open' ? q.referenceAnswer : json(q.choices)
        ])
      ];
    else throw new StudyError('unsupported', 'CSV requires flashcards or quiz content');
    omissions.push({ code: 'csv_structure' });
    body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  } else {
    if (!document)
      throw new StudyError('unsupported', 'Document export requires an exact retained Document');
    omissions.push({ code: 'metadata_sidecar' }, { code: 'source_fidelity' });
    body = document.blocks
      .map((block) => {
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
                          '>' +
                          cell.paragraphs
                            .map((p) => '<p>' + (html ? inline(p) : inline(p, true)) + '</p>')
                            .join('') +
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
        return html ? '<section id="' + escapeHtml(block.id) + '">' + out + '</section>' : out;
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
  }
  const bytes = new TextEncoder().encode(body);
  if (bytes.length > MAX_EXPORT_BYTES)
    throw new StudyError('invalid_input', 'Export exceeds byte limit');
  const extension = { markdown: 'md', html: 'html', aid_json: 'json', csv: 'csv' }[format];
  const mediaType = {
    markdown: 'text/markdown; charset=utf-8',
    html: 'text/html; charset=utf-8',
    aid_json: 'application/json',
    csv: 'text/csv; charset=utf-8'
  } as const;
  return {
    versionId: version.id,
    format,
    filename: 'material-' + String(version.id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + extension,
    mediaType: mediaType[format],
    bytes,
    omissions
  };
}
