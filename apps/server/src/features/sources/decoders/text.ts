/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Decodes UTF-8 source text into typed document blocks with byte-based anchors and   │
 * │ format-aware structure.                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Source decoders convert bounded input bytes into canonical document data.              │
 * │ - Validates format input and constructs decoded content.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Does not choose ingestion policy or persist source state.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { createBlock } from '@study/contracts/sources/document';
import type { Block } from '@study/contracts/sources/document';
import type { Document } from '@study/contracts/sources/document';
import type { BlockContent, Inline } from '@study/contracts/sources/schemas';
import type { SourceKind } from '@study/contracts/sources/sniff';

type TextInput = { bytes: Uint8Array; kind: SourceKind; mime: string };

function textBlocks(input: TextInput): Block[] {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch (cause) {
    throw new StudyError('invalid_input', 'The source is not valid UTF-8 text', { cause });
  }

  const markdown = /markdown/i.test(input.mime),
    code = input.kind === 'code';
  const blocks: Block[] = [];
  let start = 0,
    startLine = 1,
    offset = input.bytes[0] === 0xef && input.bytes[1] === 0xbb && input.bytes[2] === 0xbf ? 3 : 0,
    current = '',
    fence: string | undefined,
    currentKind: Block['kind'] = 'paragraph';
  const flush = (lineEnd: number) => {
    if (current.trim())
      blocks.push(
        createBlock(
          textContent(
            currentKind,
            currentKind === 'code' ? current.replace(/\n$/, '') : current.trim(),
            markdown
          ),
          {
            type: 'text',
            lineStart: startLine,
            lineEnd,
            start,
            end: offset
          }
        )
      );

    current = '';
  };

  function consumeFence(
    line: string,
    size: number,
    trimmed: string,
    marker: string | undefined,
    n: number
  ) {
    if (!fence) return false;

    {
      current += line;
      offset += size;

      if (marker && marker[0] === fence[0] && marker.length >= fence.length && trimmed === marker) {
        fence = undefined;
        flush(n);
      }

      return true;
    }
  }

  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  function finishLine(marker: string | undefined, n: number) {
    if (marker) fence = marker;
    else if (currentKind === 'heading') flush(n);
  }

  function consumeLine(index: number, line: string) {
    const n = index + 1,
      size = Buffer.byteLength(line),
      trimmed = line.trim();
    const marker = markdown ? /^(\x60{3,}|~{3,})/.exec(trimmed)?.[0] : undefined;

    if (consumeFence(line, size, trimmed, marker, n)) return;

    if (!trimmed) {
      flush(n - 1);
      offset += size;

      return;
    }

    if (marker || (markdown && /^#{1,6}\s/.test(trimmed))) flush(n - 1);

    if (!current) {
      start = offset;
      startLine = n;
      currentKind = blockKind(code, marker, markdown, trimmed);
    }

    current += line;
    offset += size;

    finishLine(marker, n);
  }

  for (const [index, line] of lines.entries()) {
    consumeLine(index, line);
  }

  flush(lines.length);

  return blocks;
}

export function decodeText(input: TextInput): Document {
  return {
    blocks: textBlocks(input),
    meta: {
      extractor: 'text',
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: /markdown/i.test(input.mime) ? ['unsupported_markup'] : []
    }
  };
}

function blockKind(
  code: boolean,
  marker: string | undefined,
  markdown: boolean,
  trimmed: string
): Block['kind'] {
  if (code || marker) return 'code';

  if (!markdown) return 'paragraph';

  if (/^#{1,6}\s/.test(trimmed)) return 'heading';

  if (/^([-*+]\s|\d+[.)]\s)/.test(trimmed)) return 'list_item';

  return 'paragraph';
}

function markdownInlines(text: string): Inline[] {
  const result: Inline[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let offset = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > offset)
      result.push({ type: 'text', text: text.slice(offset, match.index), marks: [] });

    if (match[5]) result.push({ type: 'link', text: match[5], href: match[6]! });
    else
      result.push({
        type: 'text',
        text: match[2] ?? match[3] ?? match[4]!,
        marks: [match[2] ? 'strong' : match[3] ? 'emphasis' : 'code']
      });

    offset = match.index + match[0].length;
  }

  if (offset < text.length) result.push({ type: 'text', text: text.slice(offset), marks: [] });

  return result;
}

function textContent(kind: Block['kind'], text: string, markdown: boolean): BlockContent {
  const inlines = (value: string): Inline[] =>
    markdown ? markdownInlines(value) : [{ type: 'text', text: value, marks: [] }];

  if (kind === 'code') return codeContent(text, markdown);

  if (kind === 'heading')
    return {
      type: 'heading',
      level: Math.min(6, /^#+/.exec(text)?.[0].length ?? 1),
      inlines: inlines(text.replace(/^#{1,6}\s+/, ''))
    };

  if (kind === 'list_item') {
    const levels: number[] = [0];

    return {
      type: 'list_item',
      items: text.split('\n').map((line) => {
        const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);

        if (!match)
          return {
            depth: levels.length - 1,
            ordered: false,
            continuation: true,
            start: 1,
            inlines: inlines(line)
          };

        const indent = match[1]!.length;

        while (levels.length > 1 && indent < levels.at(-1)!) levels.pop();

        if (indent > levels.at(-1)!) levels.push(indent);

        return {
          depth: Math.min(16, levels.length - 1),
          ordered: /\d/.test(match[2]!),
          start: Math.max(1, Number.parseInt(match[2]!) || 1),
          inlines: inlines(match[3]!)
        };
      })
    };
  }

  const lines = text.split('\n');

  if (markdown && lines.length > 1 && /^\s*\|?\s*:?-{3,}/.test(lines[1]!)) {
    return {
      type: 'table',
      rows: lines
        .filter((_, index) => index !== 1)
        .map((line, index) => ({
          cells: line
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => ({ header: index === 0, paragraphs: [inlines(cell.trim())] }))
        }))
    };
  }

  return { type: 'paragraph', inlines: inlines(text) };
}

function codeContent(text: string, markdown: boolean): BlockContent {
  const fence = markdown ? /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*)$/.exec(text) : null;

  return {
    type: 'code',
    language: fence?.[2]?.trim() || null,
    code: fence ? fence[3]!.replace(/\n(?:`{3,}|~{3,})$/, '') : text
  };
}
