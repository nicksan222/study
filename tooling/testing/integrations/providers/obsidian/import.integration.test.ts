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

import { test } from '@study/testing';
import { Effect } from 'effect';

import { obsidianVault } from './fixture.ts';

test.stable('Obsidian imports vault notes', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('notes');

        const providers = yield* vault.client['integrations.providers']({});

        test.expect(providers).toContainEqual({ id: 'obsidian', capabilities: ['import'] });
        const preview = yield* vault.preview();

        test.expect(preview.items.length).toBe(3);
        test.expect(preview.warnings.some((warning) => warning.code === 'empty_note')).toBe(true);
        const result = yield* vault.import();

        test.expect(result.status).toBe('completed');
        test
          .expect(result.items.map((item) => item.status))
          .toEqual(['imported', 'imported', 'imported']);
        const notes = yield* vault.client['notes.notes']({ limit: 100 });

        test
          .expect(notes.items.map((item) => item.title).sort())
          .toEqual(['Cell biology', 'DNA', 'Excluded']);
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});

test.stable('Obsidian preserves links and attachments', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('links-and-attachments');

        const result = yield* vault.import(['Excluded.md']);

        const documents = yield* vault.client['pages.pages']({ limit: 100, archived: false });
        const cells = documents.items.find((item) => item.title === 'Cell biology');

        test.expect(cells).toBeTruthy();
        const detail = yield* vault.client['pages.page']({ id: cells!.id });

        test.expect(detail.version).toBeTruthy();
        test
          .expect(
            detail.version!.document.blocks.some((block) => block.text.includes('genetic material'))
          )
          .toBeTruthy();
        const dnaNote = result.items.find((item) => item.key === 'Biology/DNA.md')!.noteId;
        const links = detail
          .version!.document.blocks.flatMap((block) =>
            block.content.type === 'paragraph' ? block.content.inlines : []
          )
          .filter((inline) => inline.type === 'link');

        test
          .expect(links)
          .toEqual([{ type: 'link', text: 'genetic material', href: `/note/${dnaNote}` }]);
        const sources = yield* vault.client['sources.sources']({ limit: 100 });
        const svg = sources.items.find((item) => item.name === 'cell.svg');

        test.expect(svg).toBeTruthy();
        const cellNote = result.items.find((item) => item.key === 'Biology/Cells.md')!.noteId;
        const thread = yield* vault.client['notes.thread']({
          noteId: cellNote!,
          limit: 100
        });

        test
          .expect(
            thread.items
              .flatMap((message) => message.parts)
              .some((part) => part.sourceId === svg!.id)
          )
          .toBeTruthy();
        const exported = yield* vault.client['sources.exportRevision']({
          sourceId: svg!.id,
          revision: 1n
        });

        test
          .expect(new TextDecoder().decode(exported.bytes))
          .toBe(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>'
          );
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});

test.stable('Obsidian respects excluded notes', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('exclusions');

        const result = yield* vault.import(['Excluded.md']);

        test.expect(result.status).toBe('completed');
        test
          .expect(result.items.map((item) => item.status))
          .toEqual(['imported', 'imported', 'excluded']);
        const notes = yield* vault.client['notes.notes']({ limit: 100 });

        test.expect(notes.items.map((item) => item.title).sort()).toEqual(['Cell biology', 'DNA']);
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});

test.stable('Reimporting an Obsidian vault avoids duplicates', { timeout: 60000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const vault = yield* obsidianVault('reimport');

        const first = yield* vault.import(['Excluded.md']);

        test.expect(first.status).toBe('completed');
        const second = yield* vault.import(['Excluded.md']);

        test.expect(second.status).toBe('completed');
        test
          .expect(second.items.map((item) => item.status))
          .toEqual(['unchanged', 'unchanged', 'excluded']);
        test.expect((yield* vault.client['notes.notes']({ limit: 100 })).items.length).toBe(2);
      })
    ),
    { signal: AbortSignal.timeout(45000) }
  );
});
