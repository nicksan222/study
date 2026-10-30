import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Sources } from '#server/features/sources/index';
import { App, serve } from '#server/runtime/index';

test(
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

test('running worker processes a source created through HTTP', { timeout: 10000 }, async () => {
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
});

test(
  'HTTP source ingestion durably projects the original and extracted Materials',
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

            for (let attempt = 0; attempt < 100; attempt++) {
              const page = yield* client['materials.materials']({
                projectId: project.id,
                archived: false,
                limit: 10
              });

              if (page.items.length !== 2) {
                yield* Effect.sleep('50 millis');
                continue;
              }

              const details = yield* Effect.forEach(page.items, (item) =>
                client['materials.material']({ id: item.id })
              );
              const original = details.find((item) => item.version.content.kind === 'file');
              const extracted = details.find((item) => item.version.content.kind === 'document');

              assert.ok(original);
              assert.ok(extracted);

              if (original.version.content.kind === 'file')
                assert.equal(original.version.content.source.id, source.id);

              const inputs = yield* client['materials.inputs']({
                id: extracted.version.id,
                limit: 10
              });

              assert.equal(inputs.items[0]?.id, original.version.id);
              assert.equal(extracted.version.operation, 'extract');
              const replaced = yield* client['sources.replaceSource']({
                id: source.id,
                expectedRevision: 1,
                name: 'updated.txt',
                bytes: new TextEncoder().encode('Chloroplasts capture sunlight')
              });

              assert.equal(replaced.revision, 2);
              const originalAfterReplacement = yield* client['materials.material']({
                id: original.id
              });

              assert.deepEqual(originalAfterReplacement.version.content, original.version.content);

              for (let nextAttempt = 0; nextAttempt < 100; nextAttempt++) {
                const nextPage = yield* client['materials.materials']({
                  projectId: project.id,
                  archived: false,
                  limit: 10
                });

                if (nextPage.items.length !== 4) {
                  yield* Effect.sleep('50 millis');
                  continue;
                }

                const nextDetails = yield* Effect.forEach(nextPage.items, (item) =>
                  client['materials.material']({ id: item.id })
                );
                const nextOriginal = nextDetails.find(
                  (item) => item.id !== original.id && item.version.content.kind === 'file'
                );
                const nextExtracted = nextDetails.find(
                  (item) => item.id !== extracted.id && item.version.content.kind === 'document'
                );

                assert.ok(nextOriginal);
                assert.ok(nextExtracted);
                assert.equal(nextOriginal.version.content.kind, 'file');

                if (nextOriginal.version.content.kind === 'file')
                  assert.equal(nextOriginal.version.content.source.name, 'updated.txt');

                const nextInputs = yield* client['materials.inputs']({
                  id: nextExtracted.version.id,
                  limit: 10
                });

                assert.equal(nextInputs.items[0]?.id, nextOriginal.version.id);

                return;
              }

              assert.fail('replacement was not projected into Materials');
            }

            assert.fail('source was not projected into Materials');
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
