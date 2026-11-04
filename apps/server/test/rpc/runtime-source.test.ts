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

import assert from 'node:assert/strict';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Sources } from '#server/features/sources/index';
import { App, serve } from '#server/runtime/index';

testStable(
  'runtime consumes source requests made over HTTP and recovers pending requests on reopen',
  { timeout: 15000 },
  async () => {
    const location = createTestDatabase();
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

        for (let attempt = 0; attempt < 100; attempt++) {
          const state = yield* client['sources.sourceProcessing']({ id });

          if (state.documentId === null) {
            yield* Effect.sleep('50 millis');
            continue;
          }

          yield* client['sources.correctBlock']({
            id,
            documentId: state.documentId,
            ordinal: 0,
            before: 'Hello',
            after: 'Corrected'
          });

          for (let correction = 0; correction < 100; correction++) {
            const updated = yield* client['sources.sourceProcessing']({ id });

            if (updated.documentId !== null && updated.documentId !== state.documentId) {
              const document = yield* Effect.promise(() =>
                app.nativeRuntime.runPromise(
                  Effect.flatMap(Sources, (sources) => sources.sourceDocument(id))
                )
              );

              assert.equal(document.document.blocks[0]?.text, 'Corrected');

              return;
            }

            yield* Effect.sleep('50 millis');
          }

          assert.fail('source correction was not consumed');
        }

        assert.fail('source was not processed');
      }

      await Effect.runPromise(Effect.scoped(Effect.gen(verifyRecoveredSource)));
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);

testStable(
  'running worker processes a source created through HTTP',
  { timeout: 10000 },
  async () => {
    const location = createTestDatabase();
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

            for (let attempt = 0; attempt < 100; attempt++) {
              if (
                (yield* client['sources.sourceProcessing']({ id: source.id })).documentId !== null
              ) {
                const search = yield* client['system.search']({ query: 'mitochondria', limit: 5 });
                const hit = search.hits.find(
                  (item) => item.target.type === 'source' && item.target.sourceId === source.id
                );

                assert.ok(hit);
                assert.equal(hit.target.type, 'source');

                if (hit.target.type === 'source') assert.equal(hit.target.anchor?.type, 'text');

                return;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.fail('source was not processed');
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);

testStable(
  'HTTP import retains one Material with exact original and extracted revisions',
  { timeout: 15000 },
  async () => {
    const location = createTestDatabase();
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
              for (let attempt = 0; attempt < 100; attempt++) {
                const page = yield* client['materials.materials']({
                  projectId: project.id,
                  archived: false,
                  limit: 10
                });

                assert.equal(page.items.length, 1);
                const material = yield* client['materials.material']({ id: page.items[0]!.id });

                if (
                  material.version.content.kind === 'file' &&
                  material.importProcessing?.status === 'ready' &&
                  material.version.content.extracted?.document.blocks[0]?.text === text
                )
                  return material;

                yield* Effect.sleep('50 millis');
              }

              throw new Error('import extraction was not projected');
            }

            const extracted = yield* waitForExtraction('Mitochondria generate ATP');
            const inputs = yield* client['materials.inputs']({
              id: extracted.version.id,
              limit: 10
            });

            assert.equal(inputs.items.length, 1);
            const original = yield* client['materials.materialVersion']({
              id: inputs.items[0]!.id
            });

            assert.equal(original.material_id, extracted.id);
            assert.equal(original.operation, 'original');
            const replaced = yield* client['sources.replaceSource']({
              id: source.id,
              expectedRevision: 1,
              name: 'updated.txt',
              bytes: new TextEncoder().encode('Chloroplasts capture sunlight')
            });

            assert.equal(replaced.revision, 2);
            const next = yield* waitForExtraction('Chloroplasts capture sunlight');

            assert.equal(next.id, extracted.id);
            assert.notEqual(next.version.id, extracted.version.id);
            const old = yield* client['materials.materialVersion']({ id: extracted.version.id });

            assert.deepEqual(old.content, extracted.version.content);
            const oldBytes = yield* client['materials.materialVersionExport']({ id: old.id });
            const nextBytes = yield* client['materials.materialVersionExport']({
              id: next.version.id
            });

            assert.deepEqual(oldBytes.bytes, new TextEncoder().encode('Mitochondria generate ATP'));
            assert.deepEqual(
              nextBytes.bytes,
              new TextEncoder().encode('Chloroplasts capture sunlight')
            );
          })
        )
      );
      const check = location.open();

      try {
        const snapshots = check.orm.all(
          sql`SELECT revision, bytes FROM source_snapshots ORDER BY revision`
        ) as { revision: bigint; bytes: Uint8Array }[];

        assert.equal(snapshots.length, 2);
        assert.deepEqual(
          Buffer.from(snapshots[0]!.bytes),
          Buffer.from('Mitochondria generate ATP')
        );
        assert.deepEqual(
          Buffer.from(snapshots[1]!.bytes),
          Buffer.from('Chloroplasts capture sunlight')
        );
      } finally {
        check.close();
      }
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);
