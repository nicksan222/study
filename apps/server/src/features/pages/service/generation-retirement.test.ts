import { sql } from '@study/db';
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
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { deletionDocument } from '#testing/material-deletion';
import { assertScrubbed, cleanup, validPageTransformOutput } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

for (const mode of ['history', 'delete'] as const)
  test.stable(
    `generated authored ${mode} preserves receipt identities and scrubs instructions on entity deletion`,
    async ({ databases }) => {
      const f = await pageTransformFixture(databases);

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

            test.assert.ok(input.version);
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
          }).pipe(Effect.provide(f.services()))
        );
        const event = f.authoredEvent(saved.request.id);

        f.replies.push(
          { kind: 'sources', query: 'Generation evidence' },
          { kind: 'output', output: validPageTransformOutput('INTENTIONAL_AUTHORED_BODY [1]') }
        );
        const resultId = await f.executeAuthored(event, 'authored-generation');
        // The official execution already retains activity results and its final reply.

        f.context.db.orm.run(
          sql`INSERT INTO workflow_configuration_waits(execution_id,deferred_name,observed_revision) VALUES('authored-generation','INTENTIONAL_AUTHORED_BODY','INTENTIONAL_AUTHORED_BODY')`
        );
        const independentPayload = JSON.stringify({
          event: {
            ...event,
            requestId: 'independent-request',
            correlationId: 'independent-request',
            eventId: 'independent-event',
            retained: 'Independent private content'
          }
        });

        f.context.db.orm.run(
          sql`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at) VALUES('independent-native','document-transform/v1',1,${independentPayload},'suspended',1,1)`
        );
        const retained = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            yield* Notes;
            const output = yield* docs.version({ id: resultId });

            test.assert.notStrictEqual(output.pageId, saved.input.id);
            test
              .expect(output.inputs)
              .toStrictEqual([{ kind: 'page', versionId: saved.input.version.id }]);
            const copy = yield* docs.create({
              createKey: crypto.randomUUID(),
              title: 'Independent intentional copy',
              document: deletionDocument('Independent intentional copy'),
              inputs: [],
              citations: []
            });

            test.assert.ok(copy.version);
            f.context.db.exec(
              "CREATE TRIGGER reject_private_retirement BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected retirement rollback'); END"
            );
            const failedPreview = yield* docs.previewDeletion({ id: output.pageId });

            yield* Effect.flip(docs.delete({ pageId: output.pageId, token: failedPreview.token }));
            test.assert.ok(
              JSON.stringify(
                f.context.db.orm.all(sql`SELECT * FROM cluster_replies`),
                (_key, value) => (typeof value === 'bigint' ? String(value) : value)
              ).includes('INTENTIONAL_AUTHORED_BODY'),
              'rollback must retain private official workflow replies'
            );
            test.assert.strictEqual(
              f.context.db.orm.get(
                sql`SELECT count(*) n FROM workflow_retired_correlations WHERE correlation_id=${saved.request.id}`
              )?.n,
              0n
            );
            test.assert.ok(yield* docs.version({ id: output.id }));
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

              test.expect(preview.versionIds).toStrictEqual([output.id]);
              yield* docs.retireHistory({ ...scope, token: preview.token });
              test.assert.strictEqual(
                (yield* docs.transform({ requestId: saved.request.id })).instruction,
                'Retained authored generation instruction'
              );
              test.assert.ok(
                (yield* docs.version({ id: current.submittedVersionId })).document.blocks[0]
                  ?.text === 'Current authored body'
              );
            } else {
              const preview = yield* docs.previewDeletion({ id: output.pageId });

              yield* docs.delete({ pageId: output.pageId, token: preview.token });
            }

            test.assert.ok(
              (yield* Effect.flip(docs.version({ id: output.id }))).kind === 'not_found'
            );
            // Retirement must scrub native output while the independent raw note still exists.
            assertScrubbed(f, 'INTENTIONAL_AUTHORED_BODY', false);
            test.assert.ok(
              f.context.db.orm.get(sql`SELECT 1 FROM notes WHERE id=${saved.note.id}`)
            );
            assertScrubbed(f, 'INTENTIONAL_AUTHORED_BODY', false);
            // Raw note pins and any current authored version keep original evidence alive.
            test.assert.ok(
              (yield* docs.previewDeletion({ id: saved.input.id })).blockedVersionIds.includes(
                saved.input.version.id
              )
            );

            return { copy: copy.version, outputId: output.pageId };
          }).pipe(Effect.provide(f.services()))
        );
        // Reopen with the raw note retained: retiring its independent output is sufficient.

        await f.reopen();
        test.assert.ok(f.context.db.orm.get(sql`SELECT 1 FROM notes WHERE id=${saved.note.id}`));
        assertScrubbed(f, 'INTENTIONAL_AUTHORED_BODY', false);
        test.assert.ok(
          f.context.db.orm.get(
            sql`SELECT payload FROM workflow_executions WHERE execution_id='independent-native'`
          )?.payload === independentPayload
        );
        const callsBeforeReplay = f.bodies.length;

        await test
          .expect(f.executeAuthored(event, 'retired-body-note-retained-replay'))
          .rejects.toSatisfy(() => true);
        test.assert.strictEqual(f.bodies.length, callsBeforeReplay);
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            const chats = yield* Notes;

            yield* chats.deleteNote(saved.note.id);

            if (mode === 'history') {
              test.assert.ok(
                (yield* docs.previewDeletion({ id: saved.input.id })).blockedVersionIds.includes(
                  saved.input.version.id
                )
              );
              const preview = yield* docs.previewDeletion({ id: retained.outputId });

              yield* docs.delete({ pageId: retained.outputId, token: preview.token });
            }

            const released = yield* docs.previewDeletion({ id: saved.input.id });

            test.expect(released.blockedVersionIds).toStrictEqual([]);
            yield* docs.delete({ pageId: saved.input.id, token: released.token });
          }).pipe(Effect.provide(f.services()))
        );
        await cleanup(f, saved.note.id);
        await f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            const chats = yield* Notes;

            test.expect(yield* docs.version({ id: retained.copy.id })).toStrictEqual(retained.copy);
            test.assert.ok(
              (yield* Effect.flip(docs.version({ id: resultId }))).kind === 'not_found'
            );
            test.assert.ok(
              (yield* Effect.flip(chats.noteContext({ requestId: saved.capture.requestId })))
                .kind === 'not_found'
            );
            const request = yield* docs.transform({ requestId: saved.request.id });

            test.assert.strictEqual(request.resultVersionId, resultId);
            test.assert.strictEqual(request.instruction, '');
            test.assert.strictEqual(request.title, '-');
            test.assert.strictEqual(request.report, null);
          }).pipe(Effect.provide(f.services()))
        );
        const receipt = f.context.db.orm.select().from(s.page_generation_requests).get();

        test.assert.ok(receipt);
        test.assert.strictEqual(receipt.page_id, retained.outputId);
        test.assert.strictEqual(receipt.result_version_id, resultId);
        test.assert.ok(
          f.context.db.orm.get(sql`SELECT instruction FROM page_versions WHERE id=${resultId}`)
            ?.instruction === null
        );

        for (const mutation of [
          sql`UPDATE page_transform_requests SET instruction='Restored private instruction' WHERE id=${saved.request.id}`,
          sql`UPDATE page_transform_requests SET request=json_set(request,'$.title','Restored title') WHERE id=${saved.request.id}`,
          sql`UPDATE page_transform_requests SET report='{"notes":[]}' WHERE id=${saved.request.id}`,
          sql`UPDATE page_generation_requests SET result_version_id=NULL`,
          sql`UPDATE page_generation_requests SET page_id=${saved.input.id}`,
          sql`DELETE FROM page_generation_requests`
        ])
          test.assert.throws(() => f.context.db.orm.run(mutation));

        const calls = f.bodies.length;

        await test
          .expect(f.executeAuthored(event, 'late-retired-authored-generation'))
          .rejects.toSatisfy(() => true);
        test.assert.strictEqual(f.bodies.length, calls);
        test.assert.strictEqual(
          f.context.db.orm.get(
            sql`SELECT count(*) n FROM blocks WHERE text LIKE '%INTENTIONAL_AUTHORED_BODY%'`
          )?.n,
          0n
        );
        test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
