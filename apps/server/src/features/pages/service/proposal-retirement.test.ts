/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exact proposals retain bases/evidence and immutable receipts until explicit        │
 * │ dependent body retirement.                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies retained identities and exact proposal retirement invariants.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { deletionDocument } from '#testing/material-deletion';
import { setup, cleanup, validDocumentTransformOutput } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

for (const apply of [false, true])
  testStable(
    `completed ${apply ? 'applied' : 'kept'} proposal retains exact bases, evidence and replay identity independently of body retirement`,
    async () => {
      const f = await pageTransformFixture();

      try {
        const additional = await Effect.runPromise(
          Effect.flatMap(Pages, (docs) =>
            docs.create({
              createKey: randomUUID(),
              title: 'Supporting evidence',
              document: deletionDocument('Additional proposal evidence'),
              inputs: [],
              citations: []
            })
          ).pipe(Effect.provide(f.domain()))
        );

        assert.ok(additional.version);
        const saved = await setup(f, 'PROPOSAL_HISTORY_PRIVATE', true, additional.version.id);
        const event = f.authoredEvent(saved.request.id);

        f.replies.push(
          { kind: 'sources', query: 'independent' },
          {
            kind: 'output',
            output: validDocumentTransformOutput('PUBLISHED_PROPOSAL_HISTORY_COPY [1]')
          }
        );
        const proposedId = await f.executeAuthored(event, 'history-proposal-generation');
        const retained = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;
            const chats = yield* Notes;
            const proposed = yield* docs.version({ id: proposedId });

            assert.ok(proposed.status === 'draft');

            if (!apply)
              yield* docs.save({
                pageId: saved.library.id,
                expectedVersionId: saved.library.version.id,
                key: 'manual-current',
                document: deletionDocument('Current manual body')
              });

            const keepInput = {
              requestId: saved.request.id,
              key: 'history-keep',
              title: 'Independent proposal copy'
            };
            const keep = yield* chats.keepDocumentProposal(keepInput);

            assert.ok(keep.resultVersionId);
            const applyInput = {
              requestId: saved.request.id,
              key: 'history-apply',
              expectedVersionId: saved.library.version.id
            };
            const applied = apply ? yield* chats.applyDocumentProposal(applyInput) : null;

            if (applied) {
              assert.ok(applied.outcome === 'applied');
              assert.ok(applied.resultVersionId);
            }

            yield* docs.save({
              pageId: additional.id,
              expectedVersionId: additional.version!.id,
              key: 'additional-current',
              document: deletionDocument('Current supporting evidence')
            });
            const copy = yield* docs.version({ id: keep.resultVersionId });

            expect(copy.inputs).toStrictEqual(proposed.inputs);
            expect(copy.citations).toStrictEqual(proposed.citations);
            const history = yield* docs.previewHistory({
              pageId: saved.library.id,
              keepLatest: 1
            });

            if (!apply) assert.ok(history.blockedVersionIds.includes(saved.library.version.id));

            const support = yield* docs.previewHistory({
              pageId: additional.id,
              keepLatest: 1
            });

            assert.ok(support.blockedVersionIds.includes(additional.version!.id));
            yield* chats.deleteNote(saved.note.id);
            assert.ok(
              (yield* docs.previewHistory({
                pageId: additional.id,
                keepLatest: 1
              })).blockedVersionIds.includes(additional.version!.id)
            );
            const independent = yield* docs.create({
              createKey: randomUUID(),
              title: 'Intentional independent text',
              document: deletionDocument('PUBLISHED_PROPOSAL_HISTORY_COPY'),
              inputs: [],
              citations: []
            });

            assert.ok(independent.version);
            const removeCopy = yield* docs.previewDeletion({ id: copy.pageId });

            yield* docs.delete({ pageId: copy.pageId, token: removeCopy.token });
            const removeTarget = yield* docs.previewDeletion({ id: saved.library.id });

            expect(removeTarget.blockedVersionIds).toStrictEqual([]);
            yield* docs.delete({ pageId: saved.library.id, token: removeTarget.token });
            const released = yield* docs.previewHistory({
              pageId: additional.id,
              keepLatest: 1
            });

            expect(released.blockedVersionIds).toStrictEqual([]);
            yield* docs.retireHistory({
              pageId: additional.id,
              keepLatest: 1,
              token: released.token
            });

            return { keepInput, applyInput, keep, applied, copy, independent: independent.version };
          }).pipe(Effect.provide(f.domain()))
        );

        await cleanup(f, saved.note.id);
        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;
            const chats = yield* Notes;

            expect(yield* docs.version({ id: retained.independent.id })).toStrictEqual(
              retained.independent
            );
            assert.ok(
              (yield* Effect.flip(docs.version({ id: retained.copy.id }))).kind === 'not_found'
            );
            assert.ok((yield* Effect.flip(docs.version({ id: proposedId }))).kind === 'not_found');
            assert.ok(
              (yield* Effect.flip(docs.version({ id: additional.version!.id }))).kind ===
                'not_found'
            );
            expect(yield* chats.keepDocumentProposal(retained.keepInput)).toStrictEqual({
              ...retained.keep,
              replayed: true
            });

            if (retained.applied)
              expect(yield* chats.applyDocumentProposal(retained.applyInput)).toStrictEqual({
                ...retained.applied,
                replayed: true
              });

            assert.ok(
              (yield* Effect.flip(
                chats.keepDocumentProposal({ ...retained.keepInput, key: 'new-after-retirement' })
              )).kind === 'not_found'
            );
            assert.ok(
              (yield* Effect.flip(chats.noteContext({ requestId: saved.capture.requestId })))
                .kind === 'not_found'
            );
          }).pipe(Effect.provide(f.domain()))
        );
        assert.strictEqual(
          f.context.db.orm.select().from(s.page_proposals).get()?.proposed_version_id,
          proposedId
        );
        assert.strictEqual(
          f.context.db.orm.select().from(s.page_proposal_receipts).all().length,
          apply ? 2 : 1
        );
        const calls = f.bodies.length;

        await expect(f.executeAuthored(event, 'retired-proposal-replay')).rejects.toSatisfy(
          () => true
        );
        assert.strictEqual(f.bodies.length, calls);
        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
