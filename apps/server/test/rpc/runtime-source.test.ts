/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates and corrects sources through HTTP while the durable worker is stopped or   │
 * │ running. Reopening the application must recover pending requests and publish corrected   │
 * │ document content.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: runtime consumes source requests made over HTTP and recovers pending requests │
 * │   on reopen; running worker processes a source created through HTTP.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/features/sources/index, #server/runtime/index with    │
 * │ real SQLite and application resources; fixture cleanup closes owned resources.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Sources } from '#server/features/sources/index';
import { App, serve } from '#server/runtime/index';
import { pollUntil } from '#testing/poll';

testStable(
  'runtime consumes source requests made over HTTP and recovers pending requests on reopen',
  { timeout: 15000 },
  async () => {
    const location = await createTestDatabase();
    let app = await App.open({ path: location.path });
    let server = await serve(app);

    try {
      const id = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const source = yield* client['sources.createSource']({
              name: 'notes.txt',
              bytes: new TextEncoder().encode('Hello'),
              projectId: null
            });

            return source.id;
          })
        )
      );

      await server.close();
      await app.close();
      app = await App.open({ path: location.path });
      server = await serve(app);
      await app.workers.start();

      function* verifyRecoveredSource() {
        const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

        const state = yield* pollUntil(
          client['sources.sourceProcessing']({ id }),
          (value) => value.documentId !== null,
          { attempts: 100, interval: '50 millis', message: 'Source was not processed' }
        );

        assert.ok(state.documentId !== null);
        yield* client['sources.correctBlock']({
          id,
          documentId: state.documentId,
          ordinal: 0,
          before: 'Hello',
          after: 'Corrected'
        });
        yield* pollUntil(
          client['sources.sourceProcessing']({ id }),
          (value) => value.documentId !== null && value.documentId !== state.documentId,
          { attempts: 100, interval: '50 millis', message: 'Source correction was not consumed' }
        );
        const document = yield* Effect.promise(() =>
          app.nativeRuntime.runPromise(
            Effect.flatMap(Sources, (sources) => sources.sourceDocument(id))
          )
        );

        assert.ok(document.document.blocks[0]?.text === 'Corrected');
      }

      await Effect.runPromise(Effect.scoped(Effect.gen(verifyRecoveredSource)));
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);

testStable(
  'running worker processes a source created through HTTP',
  { timeout: 10000 },
  async () => {
    const location = await createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const source = yield* client['sources.createSource']({
              name: 'live.txt',
              bytes: new TextEncoder().encode('Mitochondria generate ATP'),
              projectId: null
            });

            yield* pollUntil(
              client['sources.sourceProcessing']({ id: source.id }),
              (value) => value.documentId !== null,
              { attempts: 100, interval: '50 millis', message: 'Source was not processed' }
            );
            const search = yield* client['system.search']({ query: 'mitochondria', limit: 5 });
            const hit = search.hits.find(
              (item) => item.target.type === 'source' && item.target.sourceId === source.id
            );

            assert.ok(hit);
            assert.ok(hit.target.type === 'source');

            if (hit.target.type === 'source') assert.ok(hit.target.anchor?.type === 'text');
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);

testStable(
  'HTTP source upload retains exact original bytes and extraction history without authoring or projecting a Material',
  { timeout: 15000 },
  async () => {
    const location = await createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Projection' });
            const source = yield* client['sources.createSource']({
              name: 'biology.txt',
              bytes: new TextEncoder().encode('Mitochondria generate ATP'),
              projectId: project.id
            });

            function* waitForExtraction(text: string) {
              const extraction = yield* pollUntil(
                client['sources.currentExtraction']({ id: source.id }),
                (value) => value?.document.blocks[0]?.text === text,
                {
                  attempts: 100,
                  interval: '50 millis',
                  message: 'Source extraction did not publish'
                }
              );

              assert.ok(extraction);

              return extraction;
            }

            const extracted = yield* waitForExtraction('Mitochondria generate ATP');

            assert.strictEqual(
              (yield* client['materials.materials']({
                projectId: project.id,
                archived: false,
                limit: 10
              })).items.length,
              0
            );
            assert.strictEqual(
              (yield* client['pages.pages']({
                projectId: project.id,
                archived: false,
                limit: 10
              })).items.length,
              0
            );
            const replaced = yield* client['sources.replaceSource']({
              id: source.id,
              expectedRevision: 1,
              name: 'updated.txt',
              bytes: new TextEncoder().encode('Chloroplasts capture sunlight')
            });

            assert.strictEqual(replaced.revision, 2);
            const next = yield* waitForExtraction('Chloroplasts capture sunlight');

            assert.strictEqual(next.sourceId, extracted.sourceId);
            assert.notStrictEqual(next.snapshotId, extracted.snapshotId);
            const old = yield* client['sources.extraction']({
              sourceId: source.id,
              revision: 1n,
              snapshotId: extracted.snapshotId
            });

            expect(old.document).toStrictEqual(extracted.document);
            const oldBytes = yield* client['sources.exportRevision']({
              sourceId: source.id,
              revision: 1n
            });
            const nextBytes = yield* client['sources.exportRevision']({
              sourceId: source.id,
              revision: 2n
            });

            expect(oldBytes.bytes).toStrictEqual(
              new TextEncoder().encode('Mitochondria generate ATP')
            );
            expect(nextBytes.bytes).toStrictEqual(
              new TextEncoder().encode('Chloroplasts capture sunlight')
            );
            const history = yield* client['sources.extractions']({
              sourceId: source.id,
              limit: 10
            });

            expect(history.items.map((item) => item.snapshotId)).toStrictEqual([
              next.snapshotId,
              extracted.snapshotId
            ]);
          })
        )
      );
      const check = await location.open();

      try {
        const snapshots = check.orm.all(
          sql`SELECT revision, bytes FROM source_snapshots ORDER BY revision`
        ) as { revision: bigint; bytes: Uint8Array }[];

        assert.strictEqual(snapshots.length, 2);
        expect(Buffer.from(snapshots[0]!.bytes)).toStrictEqual(
          Buffer.from('Mitochondria generate ATP')
        );
        expect(Buffer.from(snapshots[1]!.bytes)).toStrictEqual(
          Buffer.from('Chloroplasts capture sunlight')
        );
      } finally {
        check.close();
      }
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);
