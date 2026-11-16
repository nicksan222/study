import { sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises note deletion receipts behavior through real persistence                 │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies exact authored apply and keep receipts reject substituted intent across       │
 * │   note deletion and reopen.                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import * as s from '@study/db';
import { test } from '@study/testing';
/** Authored proposal receipts survive note cleanup without retired Material tombstones. */
import { Effect } from 'effect';

import { Notes } from '#server/features/notes/index';
import {
  validPageTransformOutput,
  setup,
  cleanup,
  assertScrubbed,
  annotateLibrary,
  libraryState
} from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

test.stable(
  'exact authored apply and keep receipts reject substituted intent across note deletion and reopen',
  async ({ databases }) => {
    const f = await pageTransformFixture(databases);
    const marker = 'EXACT_RECEIPT_SESSION_PRIVATE_8';

    try {
      const saved = await setup(f, marker, true);

      f.replies.push(
        { kind: 'sources', query: 'independent' },
        { kind: 'output', output: validPageTransformOutput('Independent proposal [1]') }
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
          const chats = yield* Notes;
          const keep = yield* chats.keepPageProposal(keepValue);
          const apply = yield* chats.applyPageProposal(applyValue);

          test.assert.ok(apply.outcome === 'applied');
          test.assert.ok(keep.resultVersionId);
          test.assert.ok(apply.resultVersionId);

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
            const chats = yield* Notes;

            test.expect(yield* chats.keepPageProposal(keepValue)).toStrictEqual({
              ...retained.keep,
              replayed: true
            });
            test.expect(yield* chats.applyPageProposal(applyValue)).toStrictEqual({
              ...retained.apply,
              replayed: true
            });
            const wrongVersion = retained.ids[0]!;

            for (const action of [
              chats.keepPageProposal({ ...keepValue, title: 'Substituted title' }),
              chats.keepPageProposal({ ...keepValue, requestId: 'different' }),
              chats.keepPageProposal({ ...keepValue, key: applyValue.key }),
              chats.applyPageProposal({ ...applyValue, expectedVersionId: wrongVersion }),
              chats.applyPageProposal({ ...applyValue, requestId: 'different' }),
              chats.applyPageProposal({ ...applyValue, key: keepValue.key })
            ])
              test.assert.ok((yield* Effect.flip(action)).kind === 'invalid_input');
          }).pipe(Effect.provide(f.domain()))
        );
      const receipts = () => f.context.db.orm.select().from(s.page_proposal_receipts).all();
      const beforeReceipts = receipts();
      const rejectForged = () => {
        for (const mutation of [
          sql`UPDATE page_proposal_receipts SET intent=json_set(intent,'$.title','forged')`,
          sql`UPDATE page_proposal_receipts SET request_id='different'`,
          sql`UPDATE page_proposal_receipts SET result_version_id=${saved.library.version.id}`,
          sql`DELETE FROM page_proposal_receipts`,
          sql`INSERT OR IGNORE INTO page_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id,result_version_id) SELECT key,request_id,operation,'{}',outcome,current_version_id,result_version_id FROM page_proposal_receipts`
        ])
          test.assert.throws(() => f.context.db.orm.run(mutation));

        test.expect(receipts()).toStrictEqual(beforeReceipts);
      };

      await checkReplay();
      rejectForged();
      await annotateLibrary(f, retained.ids);
      const before = await libraryState(f, retained.ids);
      const after = before.map((state) => ({
        ...state,
        version: {
          ...state.version,
          unavailableInputs: state.version.inputs.filter((input) => input.kind === 'message')
        }
      }));

      await Effect.runPromise(
        Effect.flatMap(Notes, (chats) => chats.deleteNote(saved.note.id)).pipe(
          Effect.provide(f.domain())
        )
      );
      await checkReplay();
      rejectForged();
      await cleanup(f, saved.note.id);
      await checkReplay();
      rejectForged();
      test.expect(await libraryState(f, retained.ids)).toStrictEqual(after);
      assertScrubbed(f, marker);
      await f.reopen();
      await checkReplay();
      rejectForged();
      test.expect(await libraryState(f, retained.ids)).toStrictEqual(after);
      assertScrubbed(f, marker);
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;

          for (const action of [
            chats.keepPageProposal({ ...keepValue, key: 'brand-new' }),
            chats.applyPageProposal({ ...applyValue, key: 'brand-new' })
          ])
            test.assert.ok((yield* Effect.flip(action)).kind === 'not_found');
        }).pipe(Effect.provide(f.domain()))
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);
