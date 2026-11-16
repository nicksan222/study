import { createBlock } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies authored page tools retain retry receipts and conflict alternatives.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises creation, edits, metadata, archives and memberships through public tools.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real services with an isolated SQLite database.                                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { noteTools } from './notes.ts';
import { pageTools } from './pages.ts';
import { subjectTools } from './subjects.ts';

const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

const body = (text: string) => ({
  blocks: [
    createBlock(
      { type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] },
      { type: 'authored' }
    )
  ],
  meta: {
    extractor: null,
    extractorVersion: 0,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

test.stable(
  'document tools retain retries and conflicts while updating metadata and links',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const creation = {
            createKey: 'tool-document',
            title: 'Original',
            document: body('Original body'),
            inputs: [],
            citations: []
          };
          const first = yield* pageTools.create_page.execute(creation, environment);

          test.assert.ok(first.version);
          test
            .expect((yield* pageTools.create_page.execute(creation, environment)).id)
            .toBe(first.id);
          const edit = {
            pageId: first.id,
            expectedVersionId: first.version.id,
            key: 'edit-1',
            document: body('Saved body')
          };
          const saved = yield* pageTools.save_page.execute(edit, environment);

          test.expect(saved.outcome).toBe('saved');
          test.expect((yield* pageTools.save_page.execute(edit, environment)).replayed).toBe(true);
          const conflict = yield* pageTools.save_page.execute(
            { ...edit, key: 'edit-stale', document: body('Conflict body') },
            environment
          );

          test.expect(conflict.outcome).toBe('conflict');
          test
            .expect(
              (yield* pageTools.read_page_version.execute(
                { id: conflict.submittedVersionId },
                environment
              )).document.blocks[0].text
            )
            .toBe('Conflict body');
          test
            .expect(
              (yield* pageTools.read_page.execute({ id: first.id }, environment)).headVersionId
            )
            .toBe(saved.submittedVersionId);
          const updated = yield* pageTools.update_page_metadata.execute(
            {
              id: first.id,
              title: 'Revised',
              expectedTitle: first.title,
              description: 'Exam notes',
              expectedDescription: null
            },
            environment
          );

          test.expect(updated.title).toBe('Revised');
          test
            .expect(
              (yield* Effect.flip(
                pageTools.update_page_metadata.execute(
                  {
                    id: first.id,
                    title: 'Stale',
                    expectedTitle: first.title,
                    description: null,
                    expectedDescription: null
                  },
                  environment
                )
              )).kind
            )
            .toBe('invalid_input');
          const subject = yield* subjectTools.create_subject.execute(
            { name: 'Biology' },
            environment
          );
          const note = yield* noteTools.create_note.execute({ title: 'Revision' }, environment);

          yield* pageTools.link_page_subject.execute(
            { pageId: first.id, projectId: subject.id },
            environment
          );
          yield* pageTools.link_page_note.execute(
            { pageId: first.id, noteId: note.id },
            environment
          );
          test
            .expect(
              (yield* pageTools.list_pages.execute(
                { limit: 10, archived: false, projectId: subject.id, noteId: note.id },
                environment
              )).items.map((item) => item.id)
            )
            .toStrictEqual([first.id]);
          yield* pageTools.unlink_page_subject.execute(
            { pageId: first.id, projectId: subject.id },
            environment
          );
          yield* pageTools.unlink_page_note.execute(
            { pageId: first.id, noteId: note.id },
            environment
          );
          yield* pageTools.archive_page.execute({ id: first.id, archived: true }, environment);
          test
            .expect(
              (yield* pageTools.list_pages.execute({ limit: 10, archived: false }, environment))
                .items
            )
            .toHaveLength(0);
          test
            .expect(
              (yield* pageTools.list_pages.execute({ limit: 10, archived: true }, environment))
                .items
            )
            .toHaveLength(1);
          yield* pageTools.archive_page.execute({ id: first.id, archived: false }, environment);
          const restored = yield* pageTools.restore_page_version.execute(
            {
              pageId: first.id,
              expectedVersionId: saved.submittedVersionId,
              restoreVersionId: first.version.id,
              key: 'restore'
            },
            environment
          );

          test.expect(restored.outcome).toBe('saved');
          const history = yield* pageTools.list_page_versions.execute(
            { pageId: first.id, limit: 1 },
            environment
          );

          test.assert.ok(history.nextCursor);
          const inputCodec = Schema.toCodecJson(pageTools.read_page.input);

          test
            .expect((yield* Schema.decodeUnknownEffect(inputCodec)({ id: String(first.id) })).id)
            .toBe(first.id);
          const encoded = yield* Schema.encodeUnknownEffect(
            Schema.toCodecJson(pageTools.read_page.output)
          )(yield* pageTools.read_page.execute({ id: first.id }, environment));

          test.expect(() => JSON.stringify(encoded)).not.toThrow();
        }).pipe(Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
