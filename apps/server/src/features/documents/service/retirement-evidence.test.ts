/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Body retirement preserves honest annotation metadata and protects exact retained   │
 * │ evidence.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies history retirement hides annotations on removed bodies before pagination      │
 * │   while retaining explicit note revision metadata.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Documents } from '#server/features/documents/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';

function create(title: string, text: string) {
  return Effect.flatMap(Documents, (docs) =>
    docs.create({
      createKey: randomUUID(),
      title,
      document: deletionDocument(text),
      inputs: [],
      citations: []
    })
  ).pipe(
    Effect.map((value) => {
      assert.ok(value.version);

      return { ...value, version: value.version };
    })
  );
}

function target(version: StudyDocumentVersion) {
  return {
    documentId: version.documentId,
    range: {
      versionId: version.id,
      snapshotId: version.snapshotId,
      blockId: version.document.blocks[0]!.id,
      start: 0,
      end: 8
    }
  };
}

testStable(
  'history retirement hides annotations on removed bodies before pagination while retaining explicit note revision metadata',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const document = yield* create('Annotations', 'Retained annotated content');
          const oldTarget = target(document.version);
          const hidden = yield* docs.createAnnotation({
            target: oldTarget,
            kind: 'note',
            note: 'Retained note on retired body'
          });
          const moved = yield* docs.createAnnotation({
            target: oldTarget,
            kind: 'note',
            note: 'Retained original note'
          });

          yield* docs.reviseAnnotation({
            id: moved.annotation.id,
            expectedRevision: 1n,
            target: oldTarget,
            kind: 'note',
            note: 'Revised note',
            deleted: false
          });
          const edit = yield* docs.save({
            documentId: document.id,
            expectedVersionId: document.version.id,
            key: 'new-head',
            document: document.version.document
          });
          const current = yield* docs.version({ id: edit.submittedVersionId });
          const currentTarget = target(current);

          yield* docs.reviseAnnotation({
            id: moved.annotation.id,
            expectedRevision: 2n,
            target: currentTarget,
            kind: 'note',
            note: 'Revised note',
            deleted: false
          });
          const sibling = yield* docs.createAnnotation({
            target: currentTarget,
            kind: 'note',
            note: 'Sibling note'
          });
          const scope = { documentId: document.id, keepLatest: 1 };
          const preview = yield* docs.previewHistory(scope);

          f.context.db.exec(
            "CREATE TRIGGER reject_retirement BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected'); END"
          );
          yield* Effect.flip(docs.retireHistory({ ...scope, token: preview.token }));
          assert.equal(
            (yield* docs.annotation({ id: hidden.annotation.id })).note,
            'Retained note on retired body'
          );
          assert.equal(
            (yield* docs.annotations({ documentId: document.id, includeDeleted: false, limit: 10 }))
              .items.length,
            3
          );
          f.context.db.exec('DROP TRIGGER reject_retirement');
          yield* docs.retireHistory({ ...scope, token: preview.token });

          return {
            documentId: document.id,
            hidden: hidden.annotation.id,
            moved: moved.annotation.id,
            sibling: sibling.annotation.id
          };
        }).pipe(Effect.provide(f.domain()))
      );
      const visible = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;

            assert.equal(
              (yield* Effect.flip(docs.annotation({ id: saved.hidden }))).kind,
              'not_found'
            );
            const first = yield* docs.annotations({
              documentId: saved.documentId,
              includeDeleted: false,
              limit: 1
            });

            assert.deepEqual(
              first.items.map((item) => item.id),
              [saved.sibling]
            );
            assert.equal(first.nextCursor, saved.sibling);
            const second = yield* docs.annotations({
              documentId: saved.documentId,
              includeDeleted: false,
              limit: 1,
              cursor: first.nextCursor!
            });

            assert.deepEqual(
              second.items.map((item) => item.id),
              [saved.moved]
            );
            assert.equal(second.nextCursor, null);
            const history = yield* docs.annotationHistory({ id: saved.moved, limit: 1 });

            assert.equal(history.items[0]?.revision, 3n);
            assert.equal(history.nextCursor, 3n);
            const prior = yield* docs.annotationHistory({
              id: saved.moved,
              limit: 10,
              cursor: history.nextCursor!
            });

            assert.deepEqual(
              prior.items.map((item) => [item.revision, item.note]),
              [
                [2n, 'Revised note'],
                [1n, 'Retained original note']
              ]
            );
            assert.equal(prior.nextCursor, null);
          }).pipe(Effect.provide(f.domain()))
        );

      await visible();
      f.reopen();
      await visible();
      assert.equal(
        f.context.db.orm.select().from(s.study_document_annotation_revisions).all().length,
        5
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  }
);

for (const mode of ['delete', 'prune'] as const)
  testStable(
    `${mode} removes claim-owned judgments atomically while unrelated exact assessments remain`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const evidence = yield* create('Evidence', 'Evidence passage');
            const input = { kind: 'document' as const, versionId: evidence.version.id };
            const evidenceRange = {
              blockId: evidence.version.document.blocks[0]!.id,
              start: 0,
              end: 8
            };
            const claims = [];

            for (const note of ['Removed judgment', 'Retained judgment']) {
              const claim = yield* docs.create({
                createKey: randomUUID(),
                title: 'Claim',
                document: deletionDocument('Claim text [1]'),
                inputs: [input],
                citations: [
                  {
                    marker: 1,
                    input,
                    anchor: { type: 'authored' },
                    target: evidenceRange,
                    quote: 'Evidence'
                  }
                ]
              });

              assert.ok(claim.version);
              yield* docs.assessCitation({
                claim: target(claim.version),
                marker: 1,
                evidence: input,
                evidenceRange,
                judgment: 'supports',
                note
              });
              claims.push({ ...claim, version: claim.version });
            }

            const removed = claims[0]!;

            if (mode === 'prune')
              yield* docs.save({
                documentId: removed.id,
                expectedVersionId: removed.version.id,
                key: 'advance',
                document: deletionDocument('Current claim')
              });

            return { removed, kept: claims[1]! };
          }).pipe(Effect.provide(f.domain()))
        );
        const retire = () =>
          Effect.gen(function* () {
            const docs = yield* Documents;

            if (mode === 'delete') {
              const preview = yield* docs.previewDeletion({ id: saved.removed.id });

              yield* docs.delete({ documentId: saved.removed.id, token: preview.token });
            } else {
              const scope = { documentId: saved.removed.id, keepLatest: 1 };
              const preview = yield* docs.previewHistory(scope);

              yield* docs.retireHistory({ ...scope, token: preview.token });
            }
          }).pipe(Effect.provide(f.domain()));

        f.context.db.exec(
          "CREATE TRIGGER reject_retirement BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected'); END"
        );
        await assert.rejects(Effect.runPromise(retire()));
        assert.equal(
          f.context.db.orm.select().from(s.study_document_citation_assessments).all().length,
          2
        );
        f.reopen();
        f.context.db.exec('DROP TRIGGER reject_retirement');
        await Effect.runPromise(retire());
        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;

            assert.equal(
              (yield* Effect.flip(
                docs.assessments({ versionId: saved.removed.version.id, marker: 1, limit: 10 })
              )).kind,
              'not_found'
            );
            const kept = yield* docs.assessments({
              versionId: saved.kept.version.id,
              marker: 1,
              limit: 10
            });

            assert.equal(kept.items[0]?.state, 'assessed');
            assert.equal(kept.items[0]?.assessment.note, 'Retained judgment');
          }).pipe(Effect.provide(f.domain()))
        );
        assert.equal(
          f.context.db.orm.select().from(s.study_document_citation_assessments).all().length,
          1
        );
      } finally {
        await f.close();
      }
    }
  );

for (const mode of ['delete', 'prune'] as const)
  testStable(
    `${mode} protects retained exact evidence through edits, conflicts and restores until every dependent body retires`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const evidence = yield* create('Evidence', 'Evidence passage');
            const input = { kind: 'document' as const, versionId: evidence.version.id };
            const range = { blockId: evidence.version.document.blocks[0]!.id, start: 0, end: 8 };
            const citation = {
              marker: 1,
              input,
              anchor: { type: 'authored' as const },
              target: range,
              quote: 'Evidence'
            };
            const claim = yield* docs.create({
              createKey: randomUUID(),
              title: 'Claim',
              document: deletionDocument('Claim [1]'),
              inputs: [input],
              citations: [citation]
            });

            assert.ok(claim.version);

            if (mode === 'prune')
              yield* docs.save({
                documentId: evidence.id,
                expectedVersionId: evidence.version.id,
                key: 'new-evidence',
                document: deletionDocument('New evidence')
              });

            const blocked =
              mode === 'delete'
                ? yield* docs.previewDeletion({ id: evidence.id })
                : yield* docs.previewHistory({ documentId: evidence.id, keepLatest: 1 });

            assert.deepEqual(blocked.blockedVersionIds, [evidence.version.id]);
            const rejected =
              mode === 'delete'
                ? docs.delete({ documentId: evidence.id, token: blocked.token })
                : docs.retireHistory({
                    documentId: evidence.id,
                    keepLatest: 1,
                    token: blocked.token
                  });

            assert.equal((yield* Effect.flip(rejected)).kind, 'invalid_input');
            const intent = {
              documentId: claim.id,
              expectedVersionId: claim.version.id,
              key: 'edit',
              document: deletionDocument('Edited [1]')
            };
            const edit = yield* docs.save(intent);

            assert.deepEqual(yield* docs.save(intent), { ...edit, replayed: true });
            const conflict = yield* docs.save({ ...intent, key: 'conflict' });

            assert.equal(conflict.outcome, 'conflict');
            const restored = yield* docs.restore({
              documentId: claim.id,
              expectedVersionId: edit.submittedVersionId,
              restoreVersionId: claim.version.id,
              key: 'restore'
            });

            for (const id of [
              edit.submittedVersionId,
              conflict.submittedVersionId,
              restored.submittedVersionId
            ]) {
              const v = yield* docs.version({ id });

              assert.deepEqual(v.inputs, [input]);
              assert.deepEqual(v.citations, [citation]);
            }

            const removeClaim = yield* docs.previewDeletion({ id: claim.id });

            yield* docs.delete({ documentId: claim.id, token: removeClaim.token });
            const preview =
              mode === 'delete'
                ? yield* docs.previewDeletion({ id: evidence.id })
                : yield* docs.previewHistory({ documentId: evidence.id, keepLatest: 1 });

            assert.deepEqual(preview.blockedVersionIds, []);

            if (mode === 'delete')
              yield* docs.delete({ documentId: evidence.id, token: preview.token });
            else
              yield* docs.retireHistory({
                documentId: evidence.id,
                keepLatest: 1,
                token: preview.token
              });

            return { evidence, input, citation };
          }).pipe(Effect.provide(f.domain()))
        );

        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;

            assert.equal(
              (yield* Effect.flip(docs.version({ id: saved.evidence.version.id }))).kind,
              'not_found'
            );
            assert.equal(
              (yield* Effect.flip(
                docs.create({
                  createKey: randomUUID(),
                  title: 'No resurrection',
                  document: deletionDocument('Claim'),
                  inputs: [saved.input],
                  citations: [saved.citation]
                })
              )).kind,
              'not_found'
            );

            if (mode === 'prune') {
              const current = yield* docs.document({ id: saved.evidence.id });

              assert.ok(current.version);
              assert.equal(
                (yield* Effect.flip(
                  docs.restore({
                    documentId: current.id,
                    expectedVersionId: current.version.id,
                    restoreVersionId: saved.evidence.version.id,
                    key: 'no-retired-restore'
                  })
                )).kind,
                'not_found'
              );
            }
          }).pipe(Effect.provide(f.domain()))
        );
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );
