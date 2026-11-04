import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBlock, plainBlock } from '@study/contracts/sources/document';
import type { Block, Document } from '@study/contracts/sources/document';

import type { SourceFixture } from '../types.ts';

export const paragraph = (text: string) => plainBlock('paragraph', text, { type: 'authored' });

export const heading = (text: string) => plainBlock('heading', text, { type: 'authored' });

export const code = (text: string, language: string | null = null) =>
  createBlock({ type: 'code', code: text, language });

export const math = (expression: string) => createBlock({ type: 'math', expression });

export function table(rows: readonly (readonly string[])[]) {
  return createBlock({
    type: 'table',
    rows: rows.map((cells, index) => ({
      cells: cells.map((text) => ({
        header: index === 0,
        paragraphs: [[{ type: 'text', text, marks: [] }]]
      }))
    }))
  });
}

export function document(blocks: readonly Block[], extractor: string | null = null): Document {
  return {
    blocks: [...blocks],
    meta: {
      extractor,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: []
    }
  };
}

/** Plain text fixtures retain exact UTF-8 locations; richer or binary files supply their own Document. */
export function textSource(name: string, text: string): SourceFixture {
  let offset = 0;
  let line = 1;
  const blocks = text
    .trimEnd()
    .split('\n\n')
    .map((value) => {
      const size = Buffer.byteLength(value);
      const lines = value.split('\n').length;
      const block = plainBlock('paragraph', value, {
        type: 'text',
        start: offset,
        end: offset + size,
        lineStart: line,
        lineEnd: line + lines - 1
      });

      offset += size + 2;
      line += lines + 1;

      return block;
    });

  return { name, bytes: Buffer.from(text), document: document(blocks, 'text') };
}

export function textFile(file: URL): SourceFixture {
  return textSource(basename(fileURLToPath(file)), readFileSync(file, 'utf8'));
}

/** Any file format is supported when the fixture supplies its canonical extracted content. */
export function assetFile(file: URL, extracted: Document): SourceFixture {
  return { name: basename(fileURLToPath(file)), bytes: readFileSync(file), document: extracted };
}
