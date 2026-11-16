import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises mixed-source extraction through real HTTP RPC and SQLite.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies unsupported extraction does not block same-note text siblings.                │
 * │ - Checks duplicate names retain distinct extracted content and original bytes.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses production application workers and RPC; automatic fixtures own cleanup.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

const isSourceIngestion = (item: { workflow: string }) => item.workflow === 'source-ingestion/v1';

test.stable(
  'failed extraction leaves same-note sibling sources and original bytes usable over HTTP',
  { timeout: 15000 },
  async ({ server: serverFixture, pollUntil, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const fixture = serverFixture;

    const server = fixture.manage(await serve(fixture.app));

    await fixture.app.workers.start();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

          const inputs = [
            { name: 'duplicate.txt', bytes: new TextEncoder().encode('North bank evidence') },
            { name: 'unsupported.bin', bytes: new Uint8Array([0, 255, 1, 254, 2, 253]) },
            { name: 'duplicate.txt', bytes: new TextEncoder().encode('South bank evidence') }
          ];

          const sources = yield* Effect.forEach(inputs, (input) =>
            client['sources.createSource']({ ...input, projectId: null })
          );

          const note = yield* client['notes.createNote']({ title: 'Mixed sources' });

          yield* client['notes.postMessage']({
            noteId: note.id,
            text: 'Original mixed lecture',
            sourceIds: sources.map((source) => source.id)
          });

          const { failed, north, south } = yield* pollUntil(
            Effect.gen(function* () {
              const processing = yield* client['sources.sourceProcessing']({ id: sources[1]!.id });

              const work = yield* client['workflows.executions']({
                correlationId: processing.requestId!,
                limit: 100
              });

              const failed = work.items.find(isSourceIngestion);

              const north = yield* client['sources.currentExtraction']({ id: sources[0]!.id });

              const south = yield* client['sources.currentExtraction']({ id: sources[2]!.id });

              return { failed, north, south };
            }),
            (value) => value.failed?.outcome === 'failure' && !!value.north && !!value.south,
            {
              attempts: 150,
              interval: '25 millis',
              message: 'Failed extraction and both successful siblings did not settle independently'
            }
          );

          assert.ok(failed?.outcome === 'failure' && north && south);
          assert.strictEqual(failed.failureKind, 'unsupported');
          assert.strictEqual(
            (yield* client['sources.sourceProcessing']({ id: sources[1]!.id })).documentId,
            null
          );
          expect(north.document.blocks.map((block) => block.text)).toStrictEqual([
            'North bank evidence'
          ]);
          expect(south.document.blocks.map((block) => block.text)).toStrictEqual([
            'South bank evidence'
          ]);
          assert.notStrictEqual(north.sourceId, south.sourceId);

          for (const [index, source] of sources.entries()) {
            const retained = yield* client['sources.exportRevision']({
              sourceId: source.id,
              revision: 1n
            });

            expect(retained.bytes).toStrictEqual(inputs[index]!.bytes);
          }

          const messages = yield* client['notes.thread']({ noteId: note.id, limit: 100 });

          assert.strictEqual(messages.items.length, 1);
          expect(
            messages.items[0]!.parts.filter((part) => part.sourceId !== null).map(
              (part) => part.sourceId
            )
          ).toStrictEqual(sources.map((source) => source.id));

          return;
        })
      )
    );
  }
);
