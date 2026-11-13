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

import { StudyRpc } from '@study/contracts/rpc';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';
import { createStudyTest } from '#testing/server-test';

testStable(
  'failed extraction leaves same-note sibling sources and original bytes usable over HTTP',
  { timeout: 15000 },
  async (t) => {
    const fixture = await createStudyTest(t);

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

          const sources = [];

          for (const input of inputs)
            sources.push(yield* client['sources.createSource']({ ...input, projectId: null }));

          const note = yield* client['notes.createNote']({ title: 'Mixed sources' });

          yield* client['notes.postMessage']({
            noteId: note.id,
            text: 'Original mixed lecture',
            sourceIds: sources.map((source) => source.id)
          });

          for (let attempt = 0; attempt < 150; attempt++) {
            const processing = yield* client['sources.sourceProcessing']({ id: sources[1]!.id });

            const work = yield* client['workflows.executions']({
              correlationId: processing.requestId!,
              limit: 100
            });

            const failed = work.items.find((item) => item.workflow === 'source-ingestion/v1');

            const north = yield* client['sources.currentExtraction']({ id: sources[0]!.id });

            const south = yield* client['sources.currentExtraction']({ id: sources[2]!.id });

            if (failed?.outcome === 'failure' && north && south) {
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
            }

            yield* Effect.sleep('25 millis');
          }

          assert.fail(
            'Failed extraction and both successful siblings did not settle independently'
          );
        })
      )
    );
  }
);
