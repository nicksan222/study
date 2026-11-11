/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Authored generation receipts retain metadata independently of raw notes and        │
 * │ retired bodies.                                                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies retained identities and exact generation retirement invariants.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { deletionDocument } from '#testing/material-deletion';
import { assertScrubbed, cleanup, validPageTransformOutput } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

for (const mode of ['history', 'delete'] as const)
  testStable(
    `generated authored ${mode} retires bodies without reassigning receipts, erasing instructions or resurrecting captures`,
    async () => {
      const f = await pageTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            const chats = yield* Notes;
            const input = yield* docs.create({
              createKey: crypto.randomUUID(),
              title: 'Evidence',
              document: deletionDocument('Generation evidence'),
              inputs: [],
              citations: []
            });

            assert.ok(input.version);
            const note = yield* chats.createUntitledNote({});

            yield* docs.attach({ noteId: note.id, pageId: input.id });

            yield* chats.updateNoteSelection({
              noteId: note.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'page', versionId: input.version.id },
                  scope: { kind: 'document' }
                }
              ]
            });
            const capture = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey: 'generate',
              instruction: 'Retained authored generation instruction',
              preferences: {}
            });
            const request = yield* chats.requestPageTransform({
              contextRequestId: capture.requestId,
              title: 'Authored output',
              operations: ['clarity']
            });

            return { input: { ...input, version: input.version }, note, capture, request };
          }).pipe(Effect.provide(f.domain()))
        );
        const event = f.authoredEvent(saved.request.id);

        f.replies.push(
          { kind: 'sources', query: 'Generation evidence' },
          { kind: 'output', output: validPageTransformOutput('INTENTIONAL_AUTHORED_BODY [1]') }
        );
        const resultId = await f.executeAuthored(event, 'authored-generation');
        // Exercise every private native storage location, including recovery registrations.

        f.context.db.orm.run(
          sql`INSERT INTO workflow_deferreds(execution_id,name,result) VALUES('authored-generation','private-copy','"INTENTIONAL_AUTHORED_BODY"')`
        );
        f.context.db.orm.run(
          sql`INSERT INTO workflow_configuration_waits(execution_id,deferred_name,observed_revision) VALUES('authored-generation','INTENTIONAL_AUTHORED_BODY','INTENTIONAL_AUTHORED_BODY')`
        );
        f.context.db.orm.run(
          sql`INSERT INTO workflow_clocks(execution_id,name,deferred_name,due_at) VALUES('authored-generation','INTENTIONAL_AUTHORED_BODY','private-copy',1)`
        );
        const independentPayload = JSON.stringify({
          event: {
            ...event,
            requestId: 'independent-request',
            correlationId: 'independent-request',
            eventId: 'independent-event'
          }
        });

        f.context.db.orm.run(
          sql`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at) VALUES('independent-native','document-transform/v1',1,${independentPayload},'suspended',1,1)`
        );
        f.context.db.orm.run(
          sql`INSERT INTO workflow_deferreds(execution_id,name,result) VALUES('independent-native','independent-checkpoint','"Independent private content"')`
        );
        const retained = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            yield* Notes;
            const output = yield* docs.version({ id: resultId });

            assert.notStrictEqual(output.pageId, saved.input.id);
            expect(output.inputs).toStrictEqual([
              { kind: 'page', versionId: saved.input.version.id }
            ]);
            const copy = yield* docs.create({
              createKey: crypto.randomUUID(),
              title: 'Independent intentional copy',
              document: deletionDocument('Independent intentional copy'),
              inputs: [],
              citations: []
            });

            assert.ok(copy.version);
            f.context.db.exec(
              "CREATE TRIGGER reject_private_retirement BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected retirement rollback'); END"
            );
            const failedPreview = yield* docs.previewDeletion({ id: output.pageId });

            yield* Effect.flip(docs.delete({ pageId: output.pageId, token: failedPreview.token }));
            assert.strictEqual(
              f.context.db.orm.get(
                sql`SELECT count(*) n FROM workflow_activities WHERE instr(result,'INTENTIONAL_AUTHORED_BODY')>0`
              )?.n,
              1n
            );
            assert.strictEqual(
              f.context.db.orm.get(
                sql`SELECT count(*) n FROM workflow_retired_correlations WHERE correlation_id=${saved.request.id}`
              )?.n,
              0n
            );
            assert.ok(yield* docs.version({ id: output.id }));
            f.context.db.exec('DROP TRIGGER reject_private_retirement');

            if (mode === 'history') {
              const current = yield* docs.save({
                pageId: output.pageId,
                expectedVersionId: output.id,
                key: 'current',
                document: deletionDocument('Current authored body')
              });
              const scope = { pageId: output.pageId, keepLatest: 1 };
              const preview = yield* docs.previewHistory(scope);

              expect(preview.versionIds).toStrictEqual([output.id]);
              yield* docs.retireHistory({ ...scope, token: preview.token });
              assert.ok(
                (yield* docs.version({ id: current.submittedVersionId })).document.blocks[0]
                  ?.text === 'Current authored body'
              );
            } else {
              const preview = yield* docs.previewDeletion({ id: output.pageId });

              yield* docs.delete({ pageId: output.pageId, token: preview.token });
            }

            assert.ok((yield* Effect.flip(docs.version({ id: output.id }))).kind === 'not_found');
            // Retirement must scrub native output while the independent raw note still exists.
            assert.strictEqual(
              f.context.db.orm.get(
                sql`SELECT count(*) n FROM workflow_activities WHERE instr(result,'INTENTIONAL_AUTHORED_BODY')>0`
              )?.n,
              0n
            );
            assert.ok(f.context.db.orm.get(sql`SELECT 1 FROM notes WHERE id=${saved.note.id}`));
            assertScrubbed(f, 'INTENTIONAL_AUTHORED_BODY', false);
            // Raw note pins and any current authored version keep original evidence alive.
            assert.ok(
              (yield* docs.previewDeletion({ id: saved.input.id })).blockedVersionIds.includes(
                saved.input.version.id
              )
            );

            return { copy: copy.version, outputId: output.pageId };
          }).pipe(Effect.provide(f.domain()))
        );
        // Reopen with the raw note retained: retiring its independent output is sufficient.

        await f.reopen();
        assert.ok(f.context.db.orm.get(sql`SELECT 1 FROM notes WHERE id=${saved.note.id}`));
        assertScrubbed(f, 'INTENTIONAL_AUTHORED_BODY', false);
        assert.ok(
          f.context.db.orm.get(
            sql`SELECT result FROM workflow_deferreds WHERE execution_id='independent-native'`
          )?.result === '"Independent private content"'
        );
        const callsBeforeReplay = f.bodies.length;

        await expect(
          f.executeAuthored(event, 'retired-body-note-retained-replay')
        ).rejects.toSatisfy(() => true);
        assert.strictEqual(f.bodies.length, callsBeforeReplay);
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            const chats = yield* Notes;

            yield* chats.deleteNote(saved.note.id);

            if (mode === 'history') {
              assert.ok(
                (yield* docs.previewDeletion({ id: saved.input.id })).blockedVersionIds.includes(
                  saved.input.version.id
                )
              );
              const preview = yield* docs.previewDeletion({ id: retained.outputId });

              yield* docs.delete({ pageId: retained.outputId, token: preview.token });
            }

            const released = yield* docs.previewDeletion({ id: saved.input.id });

            expect(released.blockedVersionIds).toStrictEqual([]);
            yield* docs.delete({ pageId: saved.input.id, token: released.token });
          }).pipe(Effect.provide(f.domain()))
        );
        await cleanup(f, saved.note.id);
        await f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            const chats = yield* Notes;

            expect(yield* docs.version({ id: retained.copy.id })).toStrictEqual(retained.copy);
            assert.ok((yield* Effect.flip(docs.version({ id: resultId }))).kind === 'not_found');
            assert.ok(
              (yield* Effect.flip(chats.noteContext({ requestId: saved.capture.requestId })))
                .kind === 'not_found'
            );
            const request = yield* docs.transform({ requestId: saved.request.id });

            assert.strictEqual(request.resultVersionId, resultId);
            assert.ok(request.instruction === 'Retained authored generation instruction');
          }).pipe(Effect.provide(f.domain()))
        );
        const receipt = f.context.db.orm.select().from(s.page_generation_requests).get();

        assert.ok(receipt);
        assert.strictEqual(receipt.page_id, retained.outputId);
        assert.strictEqual(receipt.result_version_id, resultId);
        assert.ok(
          f.context.db.orm.get(sql`SELECT instruction FROM page_versions WHERE id=${resultId}`)
            ?.instruction === 'Retained authored generation instruction'
        );

        for (const mutation of [
          sql`UPDATE page_generation_requests SET result_version_id=NULL`,
          sql`UPDATE page_generation_requests SET page_id=${saved.input.id}`,
          sql`DELETE FROM page_generation_requests`
        ])
          assert.throws(() => f.context.db.orm.run(mutation));

        const calls = f.bodies.length;

        await expect(
          f.executeAuthored(event, 'late-retired-authored-generation')
        ).rejects.toSatisfy(() => true);
        assert.strictEqual(f.bodies.length, calls);
        assert.strictEqual(
          f.context.db.orm.get(
            sql`SELECT count(*) n FROM blocks WHERE text LIKE '%INTENTIONAL_AUTHORED_BODY%'`
          )?.n,
          0n
        );
        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
