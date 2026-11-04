/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact proposal replay and content-free retirement receipts over SQLite.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks forged SQL proof rejection and retained library annotations after cleanup.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Controlled provider output passes through native generation and guarded publication.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { projectIdSchema } from '@study/contracts/ids';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Schema } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  validDocumentTransformOutput,
  setup,
  cleanup,
  assertScrubbed,
  annotateLibrary,
  libraryState
} from '#testing/session-deletion';

testStable(
  'exact content-free apply and keep receipts reject substituted identities across barrier, retirement and reopen',
  async () => {
    const fixture = await documentTransformFixture();

    const marker = 'EXACT_RECEIPT_SESSION_PRIVATE_8';

    try {
      const saved = await setup(fixture, marker, true);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validDocumentTransformOutput('Independent proposal publication [1]')
        }
      );

      await fixture.execute(fixture.event(saved.request.id), 'exact-receipt-proposal');

      const keepValue = { requestId: saved.request.id, key: 'exact-keep' };

      const applyValue = {
        requestId: saved.request.id,
        key: 'exact-apply',
        expectedVersionId: saved.library.version.id,
        baseVersionId: saved.library.version.id
      };

      const retained = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;

          const keep = yield* chats.keepDocumentProposal(keepValue);

          const apply = yield* chats.applyDocumentProposal(applyValue);

          assert.equal(apply.outcome, 'applied');

          assert.ok(keep.resultVersionId);

          assert.ok(apply.resultVersionId);

          return {
            keep,
            apply,
            ids: [keep.resultVersionId, apply.resultVersionId, saved.library.version.id]
          };
        }).pipe(Effect.provide(fixture.domain()))
      );

      const checkReplay = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;

            const wrongVersion = retained.ids[0]!;

            const wrongProject = Schema.decodeUnknownSync(projectIdSchema)(999n);

            assert.deepEqual(yield* chats.keepDocumentProposal(keepValue), {
              ...retained.keep,
              replayed: true
            });

            assert.deepEqual(yield* chats.applyDocumentProposal(applyValue), {
              ...retained.apply,
              replayed: true
            });

            const rejected = [
              chats.keepDocumentProposal({ ...keepValue, projectId: wrongProject }),
              chats.keepDocumentProposal({
                ...keepValue,
                requestId: `${saved.request.id}/different`
              }),
              chats.keepDocumentProposal({ ...keepValue, key: applyValue.key }),
              chats.applyDocumentProposal({ ...applyValue, expectedVersionId: wrongVersion }),
              chats.applyDocumentProposal({ ...applyValue, baseVersionId: wrongVersion }),
              chats.applyDocumentProposal({
                ...applyValue,
                requestId: `${saved.request.id}/different`
              }),
              chats.applyDocumentProposal({ ...applyValue, key: keepValue.key })
            ];

            for (const action of rejected)
              assert.equal((yield* Effect.flip(action)).kind, 'invalid_input');
          }).pipe(Effect.provide(fixture.domain()))
        );

      await checkReplay();
      // Without exact accepted retirement ownership even the correct original cannot be copied.
      assert.throws(() => insertRetiredReceipt(fixture, sql`r.intent`, sql`r.request_id`));

      await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
          Effect.provide(fixture.domain())
        )
      );

      await checkReplay();

      for (const intent of [
        sql`json_set(r.intent,'$.projectId','999')`,
        sql`json_set(r.intent,'$.expectedVersionId','999')`,
        sql`json_set(r.intent,'$.baseVersionId','999')`,
        sql`json_set(r.intent,'$.key','forged-key')`,
        sql`json_set(r.intent,'$.requestId','other-request')`,
        sql`json_set(r.intent,'$.instruction','private hidden copy')`
      ])
        assert.throws(() => insertRetiredReceipt(fixture, intent, sql`r.request_id`));

      assert.throws(() => insertRetiredReceipt(fixture, sql`r.intent`, sql`'other-request'`));

      assert.equal(
        fixture.context.db.orm.select().from(s.retired_document_proposal_receipts).all().length,
        0
      );
      // A correct preexisting tombstone must be compared and retained idempotently by cleanup.
      insertRetiredReceipt(fixture, sql`r.intent`, sql`r.request_id`);

      const exactTombstones = fixture.context.db.orm
        .select()
        .from(s.retired_document_proposal_receipts)
        .all();

      // ON CONFLICT must not hide a mismatched replacement for an existing immutable key.
      assert.throws(() =>
        insertRetiredReceipt(
          fixture,
          sql`json_set(r.intent,'$.projectId','999')`,
          sql`r.request_id`
        )
      );
      assert.deepEqual(
        fixture.context.db.orm.select().from(s.retired_document_proposal_receipts).all(),
        exactTombstones
      );

      await annotateLibrary(fixture, retained.ids);

      const before = await libraryState(fixture, retained.ids);

      await cleanup(fixture, saved.session.id);

      await checkReplay();

      assert.deepEqual(await libraryState(fixture, retained.ids), before);

      assertScrubbed(fixture, marker);

      const receipts = fixture.context.db.orm
        .select()
        .from(s.retired_document_proposal_receipts)
        .orderBy(s.retired_document_proposal_receipts.key)
        .all();

      assert.equal(receipts.length, 2);

      assert.deepEqual(
        receipts.map((row) => JSON.parse(row.intent)),
        [
          {
            ...applyValue,
            expectedVersionId: String(applyValue.expectedVersionId),
            baseVersionId: String(applyValue.baseVersionId)
          },
          keepValue
        ]
      );

      for (const receipt of receipts) {
        assert.throws(() =>
          fixture.context.db.orm.run(
            sql`UPDATE retired_document_proposal_receipts SET intent=json_set(intent,'$.projectId','999') WHERE key=${receipt.key}`
          )
        );

        assert.throws(() =>
          fixture.context.db.orm.run(
            sql`DELETE FROM retired_document_proposal_receipts WHERE key=${receipt.key}`
          )
        );
      }

      fixture.reopen();

      await checkReplay();

      assert.deepEqual(await libraryState(fixture, retained.ids), before);

      assertScrubbed(fixture, marker);

      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;

          assert.equal(
            (yield* Effect.flip(chats.keepDocumentProposal({ ...keepValue, key: 'brand-new' })))
              .kind,
            'not_found'
          );

          assert.equal(
            (yield* Effect.flip(chats.applyDocumentProposal({ ...applyValue, key: 'brand-new' })))
              .kind,
            'not_found'
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);

function insertRetiredReceipt(
  fixture: Awaited<ReturnType<typeof documentTransformFixture>>,
  intent: ReturnType<typeof sql>,
  requestId: ReturnType<typeof sql>
) {
  fixture.context.db.orm.run(sql`
    INSERT OR IGNORE INTO retired_document_proposal_receipts
    (key,intent,current_version_id,proposed_version_id,request_id,operation,outcome,base_version_id,result_version_id)
    SELECT r.key,${intent},r.current_version_id,p.proposed_version_id,${requestId},r.operation,r.outcome,p.base_version_id,r.result_version_id
    FROM document_proposal_receipts r JOIN document_proposals p ON p.request_id=r.request_id
  `);
}
