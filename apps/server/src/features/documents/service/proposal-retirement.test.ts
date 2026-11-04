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

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { setup, cleanup, validDocumentTransformOutput } from '#testing/session-deletion';

for (const apply of [false, true])
  testStable(
    `completed ${apply ? 'applied' : 'kept'} proposal retains exact bases, evidence and replay identity independently of body retirement`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const additional = await Effect.runPromise(
          Effect.flatMap(Documents, (docs) =>
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
            const docs = yield* Documents;
            const chats = yield* Conversations;
            const proposed = yield* docs.version({ id: proposedId });

            assert.equal(proposed.status, 'draft');

            if (!apply)
              yield* docs.save({
                documentId: saved.library.id,
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
              assert.equal(applied.outcome, 'applied');
              assert.ok(applied.resultVersionId);
            }

            yield* docs.save({
              documentId: additional.id,
              expectedVersionId: additional.version!.id,
              key: 'additional-current',
              document: deletionDocument('Current supporting evidence')
            });
            const copy = yield* docs.version({ id: keep.resultVersionId });

            assert.deepEqual(copy.inputs, proposed.inputs);
            assert.deepEqual(copy.citations, proposed.citations);
            const history = yield* docs.previewHistory({
              documentId: saved.library.id,
              keepLatest: 1
            });

            if (!apply) assert.ok(history.blockedVersionIds.includes(saved.library.version.id));

            const support = yield* docs.previewHistory({
              documentId: additional.id,
              keepLatest: 1
            });

            assert.ok(support.blockedVersionIds.includes(additional.version!.id));
            yield* chats.deleteSession(saved.session.id);
            assert.ok(
              (yield* docs.previewHistory({
                documentId: additional.id,
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
            const removeCopy = yield* docs.previewDeletion({ id: copy.documentId });

            yield* docs.delete({ documentId: copy.documentId, token: removeCopy.token });
            const removeTarget = yield* docs.previewDeletion({ id: saved.library.id });

            assert.deepEqual(removeTarget.blockedVersionIds, []);
            yield* docs.delete({ documentId: saved.library.id, token: removeTarget.token });
            const released = yield* docs.previewHistory({
              documentId: additional.id,
              keepLatest: 1
            });

            assert.deepEqual(released.blockedVersionIds, []);
            yield* docs.retireHistory({
              documentId: additional.id,
              keepLatest: 1,
              token: released.token
            });

            return { keepInput, applyInput, keep, applied, copy, independent: independent.version };
          }).pipe(Effect.provide(f.domain()))
        );

        await cleanup(f, saved.session.id);
        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const chats = yield* Conversations;

            assert.deepEqual(
              yield* docs.version({ id: retained.independent.id }),
              retained.independent
            );
            assert.equal(
              (yield* Effect.flip(docs.version({ id: retained.copy.id }))).kind,
              'not_found'
            );
            assert.equal((yield* Effect.flip(docs.version({ id: proposedId }))).kind, 'not_found');
            assert.equal(
              (yield* Effect.flip(docs.version({ id: additional.version!.id }))).kind,
              'not_found'
            );
            assert.deepEqual(yield* chats.keepDocumentProposal(retained.keepInput), {
              ...retained.keep,
              replayed: true
            });

            if (retained.applied)
              assert.deepEqual(yield* chats.applyDocumentProposal(retained.applyInput), {
                ...retained.applied,
                replayed: true
              });

            assert.equal(
              (yield* Effect.flip(
                chats.keepDocumentProposal({ ...retained.keepInput, key: 'new-after-retirement' })
              )).kind,
              'not_found'
            );
            assert.equal(
              (yield* Effect.flip(chats.sessionContext({ requestId: saved.capture.requestId })))
                .kind,
              'not_found'
            );
          }).pipe(Effect.provide(f.domain()))
        );
        assert.equal(
          f.context.db.orm.select().from(s.study_document_proposals).get()?.proposed_version_id,
          proposedId
        );
        assert.equal(
          f.context.db.orm.select().from(s.study_document_proposal_receipts).all().length,
          apply ? 2 : 1
        );
        const calls = f.bodies.length;

        await assert.rejects(f.executeAuthored(event, 'retired-proposal-replay'));
        assert.equal(f.bodies.length, calls);
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );
