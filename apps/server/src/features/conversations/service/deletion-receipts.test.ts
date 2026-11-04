import assert from 'node:assert/strict';

import { sql } from '@study/db';
import * as s from '@study/db/schema';
/** Authored proposal receipts survive session cleanup without retired Material tombstones. */
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

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
  'exact authored apply and keep receipts reject substituted intent across session deletion and reopen',
  async () => {
    const f = await documentTransformFixture();
    const marker = 'EXACT_RECEIPT_SESSION_PRIVATE_8';
    try {
      const saved = await setup(f, marker, true);
      f.replies.push(
        { kind: 'sources', query: 'independent' },
        { kind: 'output', output: validDocumentTransformOutput('Independent proposal [1]') }
      );
      await f.executeAuthored(f.authoredEvent(saved.request.id), 'exact-receipt-proposal');
      const keepValue = {
        requestId: saved.request.id,
        key: 'exact-keep',
        title: 'Independent copy'
      };
      const applyValue = {
        requestId: saved.request.id,
        key: 'exact-apply',
        expectedVersionId: saved.library.version.id
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
        }).pipe(Effect.provide(f.domain()))
      );
      const checkReplay = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;
            assert.deepEqual(yield* chats.keepDocumentProposal(keepValue), {
              ...retained.keep,
              replayed: true
            });
            assert.deepEqual(yield* chats.applyDocumentProposal(applyValue), {
              ...retained.apply,
              replayed: true
            });
            const wrongVersion = retained.ids[0]!;
            for (const action of [
              chats.keepDocumentProposal({ ...keepValue, title: 'Substituted title' }),
              chats.keepDocumentProposal({ ...keepValue, requestId: 'different' }),
              chats.keepDocumentProposal({ ...keepValue, key: applyValue.key }),
              chats.applyDocumentProposal({ ...applyValue, expectedVersionId: wrongVersion }),
              chats.applyDocumentProposal({ ...applyValue, requestId: 'different' }),
              chats.applyDocumentProposal({ ...applyValue, key: keepValue.key })
            ])
              assert.equal((yield* Effect.flip(action)).kind, 'invalid_input');
          }).pipe(Effect.provide(f.domain()))
        );
      const receipts = () =>
        f.context.db.orm.select().from(s.study_document_proposal_receipts).all();
      const beforeReceipts = receipts();
      const rejectForged = () => {
        for (const mutation of [
          sql`UPDATE study_document_proposal_receipts SET intent=json_set(intent,'$.title','forged')`,
          sql`UPDATE study_document_proposal_receipts SET request_id='different'`,
          sql`UPDATE study_document_proposal_receipts SET result_version_id=${saved.library.version.id}`,
          sql`DELETE FROM study_document_proposal_receipts`,
          sql`INSERT OR IGNORE INTO study_document_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id,result_version_id) SELECT key,request_id,operation,'{}',outcome,current_version_id,result_version_id FROM study_document_proposal_receipts`
        ])
          assert.throws(() => f.context.db.orm.run(mutation));
        assert.deepEqual(receipts(), beforeReceipts);
      };
      await checkReplay();
      rejectForged();
      await annotateLibrary(f, retained.ids);
      const before = await libraryState(f, retained.ids);
      await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
          Effect.provide(f.domain())
        )
      );
      await checkReplay();
      rejectForged();
      await cleanup(f, saved.session.id);
      await checkReplay();
      rejectForged();
      assert.deepEqual(await libraryState(f, retained.ids), before);
      assertScrubbed(f, marker);
      f.reopen();
      await checkReplay();
      rejectForged();
      assert.deepEqual(await libraryState(f, retained.ids), before);
      assertScrubbed(f, marker);
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          for (const action of [
            chats.keepDocumentProposal({ ...keepValue, key: 'brand-new' }),
            chats.applyDocumentProposal({ ...applyValue, key: 'brand-new' })
          ])
            assert.equal((yield* Effect.flip(action)).kind, 'not_found');
        }).pipe(Effect.provide(f.domain()))
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  }
);
