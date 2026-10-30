import { StudyError } from '@study/contracts/errors';
import type { Block } from '@study/contracts/sources/document';
import type { Document } from '@study/contracts/sources/document';
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
      blocks.push({
        kind: currentKind,
        text: current.trim(),
        anchor: {
          type: 'text',
          lineStart: startLine,
          lineEnd,
          start,
          end: offset
        }
      });

    current = '';
  };
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  for (const [index, line] of lines.entries()) {
    const n = index + 1,
      size = Buffer.byteLength(line),
      trimmed = line.trim();
    const marker = markdown ? /^(\x60{3,}|~{3,})/.exec(trimmed)?.[0] : undefined;

    if (fence) {
      current += line;
      offset += size;

      if (marker && marker[0] === fence[0] && marker.length >= fence.length && trimmed === marker) {
        fence = undefined;
        flush(n);
      }

      continue;
    }

    if (!trimmed) {
      flush(n - 1);
      offset += size;
      continue;
    }

    if (marker || (markdown && /^#{1,6}\s/.test(trimmed))) flush(n - 1);

    if (!current) {
      start = offset;
      startLine = n;
      currentKind =
        code || marker
          ? 'code'
          : markdown && /^#{1,6}\s/.test(trimmed)
            ? 'heading'
            : markdown && /^([-*+]\s|\d+[.)]\s)/.test(trimmed)
              ? 'list_item'
              : 'paragraph';
    }

    current += line;
    offset += size;

    if (marker) fence = marker;
    else if (currentKind === 'heading') flush(n);
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
      corrected: false
    }
  };
}
