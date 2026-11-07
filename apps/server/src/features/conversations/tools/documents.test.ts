/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies authored document tools retain retry receipts and conflict alternatives.  │
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

import { documentTools } from './documents.ts';
import { sessionTools } from './sessions.ts';
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
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

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
          const first = yield* documentTools.create_document.execute(creation, environment);

          assert.ok(first.version);
          expect((yield* documentTools.create_document.execute(creation, environment)).id).toBe(
            first.id
          );
          const edit = {
            documentId: first.id,
            expectedVersionId: first.version.id,
            key: 'edit-1',
            document: body('Saved body')
          };
          const saved = yield* documentTools.save_document.execute(edit, environment);

          expect(saved.outcome).toBe('saved');
          expect((yield* documentTools.save_document.execute(edit, environment)).replayed).toBe(
            true
          );
          const conflict = yield* documentTools.save_document.execute(
            { ...edit, key: 'edit-stale', document: body('Conflict body') },
            environment
          );

          expect(conflict.outcome).toBe('conflict');
          expect(
            (yield* documentTools.read_document_version.execute(
              { id: conflict.submittedVersionId },
              environment
            )).document.blocks[0].text
          ).toBe('Conflict body');
          expect(
            (yield* documentTools.read_document.execute({ id: first.id }, environment))
              .headVersionId
          ).toBe(saved.submittedVersionId);
          const updated = yield* documentTools.update_document_metadata.execute(
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
              documentTools.update_document_metadata.execute(
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
          const session = yield* sessionTools.create_session.execute(
            { title: 'Revision' },
            environment
          );

          yield* documentTools.link_document_subject.execute(
            { documentId: first.id, projectId: subject.id },
            environment
          );
          yield* documentTools.link_document_session.execute(
            { documentId: first.id, sessionId: session.id },
            environment
          );
          expect(
            (yield* documentTools.list_documents.execute(
              { limit: 10, archived: false, projectId: subject.id, sessionId: session.id },
              environment
            )).items.map((item) => item.id)
          ).toStrictEqual([first.id]);
          yield* documentTools.unlink_document_subject.execute(
            { documentId: first.id, projectId: subject.id },
            environment
          );
          yield* documentTools.unlink_document_session.execute(
            { documentId: first.id, sessionId: session.id },
            environment
          );
          yield* documentTools.archive_document.execute(
            { id: first.id, archived: true },
            environment
          );
          expect(
            (yield* documentTools.list_documents.execute(
              { limit: 10, archived: false },
              environment
            )).items
          ).toHaveLength(0);
          expect(
            (yield* documentTools.list_documents.execute(
              { limit: 10, archived: true },
              environment
            )).items
          ).toHaveLength(1);
          yield* documentTools.archive_document.execute(
            { id: first.id, archived: false },
            environment
          );
          const restored = yield* documentTools.restore_document_version.execute(
            {
              documentId: first.id,
              expectedVersionId: saved.submittedVersionId,
              restoreVersionId: first.version.id,
              key: 'restore'
            },
            environment
          );

          expect(restored.outcome).toBe('saved');
          const history = yield* documentTools.list_document_versions.execute(
            { documentId: first.id, limit: 1 },
            environment
          );

          assert.ok(history.nextCursor);
          const inputCodec = Schema.toCodecJson(documentTools.read_document.input);

          expect((yield* Schema.decodeUnknownEffect(inputCodec)({ id: String(first.id) })).id).toBe(
            first.id
          );
          const encoded = yield* Schema.encodeUnknownEffect(
            Schema.toCodecJson(documentTools.read_document.output)
          )(yield* documentTools.read_document.execute({ id: first.id }, environment));

          expect(() => JSON.stringify(encoded)).not.toThrow();
        }).pipe(Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
