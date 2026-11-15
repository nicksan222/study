/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies real Obsidian import behavior through Study application services.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks notes, links, attachments, exclusions and repeated import results.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Each test opens independent real application processes and disposable data.              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { obsidianVault } from './fixture.ts';

testStable('Obsidian imports vault notes', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('notes');

        const providers = yield* vault.client['integrations.providers']({});

        expect(providers).toContainEqual({ id: 'obsidian', capabilities: ['import'] });
        const preview = yield* vault.preview();

        expect(preview.items.length).toBe(3);
        expect(preview.warnings.some((warning) => warning.code === 'empty_note')).toBe(true);
        const result = yield* vault.import();

        expect(result.status).toBe('completed');
        expect(result.items.map((item) => item.status)).toEqual([
          'imported',
          'imported',
          'imported'
        ]);
        const notes = yield* vault.client['notes.notes']({ limit: 100 });

        expect(notes.items.map((item) => item.title).sort()).toEqual([
          'Cell biology',
          'DNA',
          'Excluded'
        ]);
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});

testStable('Obsidian preserves links and attachments', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('links-and-attachments');

        const result = yield* vault.import(['Excluded.md']);

        const documents = yield* vault.client['pages.pages']({ limit: 100, archived: false });
        const cells = documents.items.find((item) => item.title === 'Cell biology');

        expect(cells).toBeTruthy();
        const detail = yield* vault.client['pages.page']({ id: cells!.id });

        expect(detail.version).toBeTruthy();
        expect(
          detail.version!.document.blocks.some((block) => block.text.includes('genetic material'))
        ).toBeTruthy();
        const dnaNote = result.items.find((item) => item.key === 'Biology/DNA.md')!.noteId;
        const links = detail
          .version!.document.blocks.flatMap((block) =>
            block.content.type === 'paragraph' ? block.content.inlines : []
          )
          .filter((inline) => inline.type === 'link');

        expect(links).toEqual([
          { type: 'link', text: 'genetic material', href: `/note/${dnaNote}` }
        ]);
        const sources = yield* vault.client['sources.sources']({ limit: 100 });
        const svg = sources.items.find((item) => item.name === 'cell.svg');

        expect(svg).toBeTruthy();
        const cellNote = result.items.find((item) => item.key === 'Biology/Cells.md')!.noteId;
        const thread = yield* vault.client['notes.thread']({
          noteId: cellNote!,
          limit: 100
        });

        expect(
          thread.items.flatMap((message) => message.parts).some((part) => part.sourceId === svg!.id)
        ).toBeTruthy();
        const exported = yield* vault.client['sources.exportRevision']({
          sourceId: svg!.id,
          revision: 1n
        });

        expect(new TextDecoder().decode(exported.bytes)).toBe(
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>'
        );
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});

testStable('Obsidian respects excluded notes', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('exclusions');

        const result = yield* vault.import(['Excluded.md']);

        expect(result.status).toBe('completed');
        expect(result.items.map((item) => item.status)).toEqual([
          'imported',
          'imported',
          'excluded'
        ]);
        const notes = yield* vault.client['notes.notes']({ limit: 100 });

        expect(notes.items.map((item) => item.title).sort()).toEqual(['Cell biology', 'DNA']);
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});

testStable('Reimporting an Obsidian vault avoids duplicates', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('reimport');

        const first = yield* vault.import(['Excluded.md']);

        expect(first.status).toBe('completed');
        const second = yield* vault.import(['Excluded.md']);

        expect(second.status).toBe('completed');
        expect(second.items.map((item) => item.status)).toEqual([
          'unchanged',
          'unchanged',
          'excluded'
        ]);
        expect((yield* vault.client['notes.notes']({ limit: 100 })).items.length).toBe(2);
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});
