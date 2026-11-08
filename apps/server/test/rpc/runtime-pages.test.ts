/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises native runtime runtime documents behavior through real persistence       │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native HTTP runtime exposes independent Pages and persists exact saves,       │
 * │   annotations and archive.                                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';
import { createStudyTest } from '#testing/server-test';

testStable(
  'native HTTP runtime exposes independent Pages and persists exact saves, annotations and archive',
  async (t) => {
    const fixture = await createStudyTest(t);
    const server = fixture.manage(await serve(fixture.app));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const block = createBlock({
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'HTTP authored 😀', marks: ['strong'] }]
          });
          const input = {
            createKey: 'http-document',
            title: 'HTTP authored',
            inputs: [],
            citations: [],
            document: {
              blocks: [block],
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
            }
          };
          const document = yield* rpc['pages.create'](input);

          assert.ok(document.version);
          assert.strictEqual((yield* rpc['pages.create'](input)).id, document.id);
          const renamed = yield* rpc['pages.updateMetadata']({
            id: document.id,
            title: 'HTTP renamed',
            description: 'Independent authored metadata',
            expectedTitle: document.title,
            expectedDescription: null
          });

          assert.ok(renamed.title === 'HTTP renamed');
          const rejectedMetadata = yield* Effect.flip(
            rpc['pages.updateMetadata']({
              id: document.id,
              title: 'Stale rename',
              description: null,
              expectedTitle: document.title,
              expectedDescription: null
            })
          );

          assert.ok('kind' in rejectedMetadata);
          assert.ok(rejectedMetadata.kind === 'invalid_input');
          const note = yield* rpc['notes.createNote']({ title: 'HTTP source links' });
          const source = yield* rpc['sources.createSource']({
            name: 'source.txt',
            bytes: new TextEncoder().encode('Exact source bytes'),
            projectId: null
          });

          yield* rpc['sources.attachSource']({ noteId: note.id, sourceId: source.id });
          yield* rpc['sources.attachSource']({ noteId: note.id, sourceId: source.id });
          assert.strictEqual(
            (yield* rpc['sources.noteSources']({ noteId: note.id, limit: 100 })).length,
            1
          );
          yield* rpc['sources.detachSource']({ noteId: note.id, sourceId: source.id });
          assert.strictEqual(
            (yield* rpc['sources.noteSources']({ noteId: note.id, limit: 100 })).length,
            0
          );

          const saved = yield* rpc['pages.save']({
            pageId: document.id,
            expectedVersionId: document.version.id,
            key: 'http-save',
            document: input.document
          });

          assert.ok(saved.outcome === 'saved');
          const latest = yield* rpc['pages.version']({ id: saved.submittedVersionId });
          const annotation = yield* rpc['pages.createAnnotation']({
            target: {
              pageId: document.id,
              range: {
                versionId: latest.id,
                snapshotId: latest.snapshotId,
                blockId: block.id,
                start: 0,
                end: 4
              }
            },
            kind: 'note',
            note: 'HTTP exact note'
          });

          assert.ok(
            (yield* rpc['pages.annotation']({ id: annotation.annotation.id })).note ===
              'HTTP exact note'
          );
          assert.ok(
            (yield* rpc['pages.annotations']({
              pageId: document.id,
              versionId: latest.id,
              limit: 10,
              includeDeleted: false
            })).items[0].note === 'HTTP exact note'
          );
          yield* rpc['pages.archive']({ id: document.id, archived: true });
          assert.strictEqual(
            (yield* rpc['pages.pages']({ limit: 10, archived: false })).items.length,
            0
          );
          assert.strictEqual(
            (yield* rpc['pages.pages']({ limit: 10, archived: true })).items[0]?.id,
            document.id
          );
          assert.ok(
            (yield* rpc['pages.exportVersion']({ id: latest.id })).format === 'canonical_json'
          );
        })
      )
    );
    assert.strictEqual(
      fixture.store.db.orm.get(sql`SELECT count(*) AS n FROM materials WHERE kind='document'`)?.n,
      0n
    );
    expect(fixture.store.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  }
);
