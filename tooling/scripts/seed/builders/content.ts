import { BunPath } from '@effect/platform-bun';
import { createBlock, plainBlock } from '@study/contracts/sources/document';
import type { Block, Document } from '@study/contracts/sources/document';
import { Effect, Path } from 'effect';

import type { SourceFixture } from '../types.ts';

const { basename } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const fixtureDirectory = Bun.fileURLToPath(new URL('../fixtures/files/', import.meta.url));

const fixtureBytes = new Map<string, Uint8Array>();

for await (const file of new Bun.Glob('**/*').scan({ cwd: fixtureDirectory, absolute: true })) {
  fixtureBytes.set(file, new Uint8Array(await Bun.file(file).arrayBuffer()));
}

function fixture(file: URL): Uint8Array {
  const bytes = fixtureBytes.get(Bun.fileURLToPath(file));

  if (!bytes) throw new Error(`Missing seed fixture: ${file}`);

  return bytes;
}

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
      const size = new TextEncoder().encode(value).length;
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

  return { name, bytes: new TextEncoder().encode(text), document: document(blocks, 'text') };
}

export function textFile(file: URL): SourceFixture {
  return textSource(basename(Bun.fileURLToPath(file)), new TextDecoder().decode(fixture(file)));
}

/** Any file format is supported when the fixture supplies its canonical extracted content. */
export function assetFile(file: URL, extracted: Document): SourceFixture {
  return { name: basename(Bun.fileURLToPath(file)), bytes: fixture(file), document: extracted };
}
