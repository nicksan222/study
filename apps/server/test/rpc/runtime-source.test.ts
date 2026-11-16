import { StudyRpc } from '@study/contracts';
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
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Sources } from '#server/features/sources/index';
import { serve } from '#server/runtime/index';

test.server.stable(
  'runtime consumes source requests made over HTTP and recovers pending requests on reopen',
  { timeout: 15000 },
  async ({ resources: location, pollUntil, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let app = await location.openApp({ path: location.path });
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
      app = await location.openApp({ path: location.path });
      server = await serve(app);
      await app.workers.start();

      function* verifyRecoveredSource({
        pollUntil,
        assert: assertions
      }: Pick<test.server.Context, 'pollUntil' | 'assert'>) {
        const assert: test.Assert = assertions;

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

      await Effect.runPromise(
        Effect.scoped(Effect.gen(() => verifyRecoveredSource({ pollUntil, assert })))
      );
    } finally {
      await server.close();
      await app.close();
      await location.close();
    }
  }
);

test.server.stable(
  'running worker processes a source created through HTTP',
  { timeout: 10000 },
  async ({ resources: location, pollUntil, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const app = await location.openApp({ path: location.path });
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
      await location.close();
    }
  }
);

test.server.stable(
  'HTTP source upload retains exact original bytes and extraction history without authoring or projecting a Material',
  { timeout: 15000 },
  async ({ resources: location, assert: assertions, expect, pollUntil }) => {
    const assert: test.Assert = assertions;

    const app = await location.openApp({ path: location.path });
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

            function* waitForExtraction(
              { pollUntil, assert: assertions }: Pick<test.server.Context, 'pollUntil' | 'assert'>,
              text: string
            ) {
              const assert: test.Assert = assertions;

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

            const extracted = yield* waitForExtraction(
              { pollUntil, assert },
              'Mitochondria generate ATP'
            );

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
            const next = yield* waitForExtraction(
              { pollUntil, assert },
              'Chloroplasts capture sunlight'
            );

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
      const check = await location.openDb();

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
      await location.close();
    }
  }
);
