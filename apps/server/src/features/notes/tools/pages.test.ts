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

import { createBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

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

testStable(
  'document tools retain retries and conflicts while updating metadata and links',
  async () => {
    const location = await createTestDatabase();
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

          assert.ok(first.version);
          expect((yield* pageTools.create_page.execute(creation, environment)).id).toBe(first.id);
          const edit = {
            pageId: first.id,
            expectedVersionId: first.version.id,
            key: 'edit-1',
            document: body('Saved body')
          };
          const saved = yield* pageTools.save_page.execute(edit, environment);

          expect(saved.outcome).toBe('saved');
          expect((yield* pageTools.save_page.execute(edit, environment)).replayed).toBe(true);
          const conflict = yield* pageTools.save_page.execute(
            { ...edit, key: 'edit-stale', document: body('Conflict body') },
            environment
          );

          expect(conflict.outcome).toBe('conflict');
          expect(
            (yield* pageTools.read_page_version.execute(
              { id: conflict.submittedVersionId },
              environment
            )).document.blocks[0].text
          ).toBe('Conflict body');
          expect(
            (yield* pageTools.read_page.execute({ id: first.id }, environment)).headVersionId
          ).toBe(saved.submittedVersionId);
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

          expect(updated.title).toBe('Revised');
          expect(
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
          ).toBe('invalid_input');
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
          expect(
            (yield* pageTools.list_pages.execute(
              { limit: 10, archived: false, projectId: subject.id, noteId: note.id },
              environment
            )).items.map((item) => item.id)
          ).toStrictEqual([first.id]);
          yield* pageTools.unlink_page_subject.execute(
            { pageId: first.id, projectId: subject.id },
            environment
          );
          yield* pageTools.unlink_page_note.execute(
            { pageId: first.id, noteId: note.id },
            environment
          );
          yield* pageTools.archive_page.execute({ id: first.id, archived: true }, environment);
          expect(
            (yield* pageTools.list_pages.execute({ limit: 10, archived: false }, environment)).items
          ).toHaveLength(0);
          expect(
            (yield* pageTools.list_pages.execute({ limit: 10, archived: true }, environment)).items
          ).toHaveLength(1);
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

          expect(restored.outcome).toBe('saved');
          const history = yield* pageTools.list_page_versions.execute(
            { pageId: first.id, limit: 1 },
            environment
          );

          assert.ok(history.nextCursor);
          const inputCodec = Schema.toCodecJson(pageTools.read_page.input);

          expect((yield* Schema.decodeUnknownEffect(inputCodec)({ id: String(first.id) })).id).toBe(
            first.id
          );
          const encoded = yield* Schema.encodeUnknownEffect(
            Schema.toCodecJson(pageTools.read_page.output)
          )(yield* pageTools.read_page.execute({ id: first.id }, environment));

          expect(() => JSON.stringify(encoded)).not.toThrow();
        }).pipe(Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
