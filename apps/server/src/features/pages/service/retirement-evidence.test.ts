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

import type { PageVersion } from '@study/contracts/pages/types';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Pages } from '#server/features/pages/index';
import { deletionDocument } from '#testing/material-deletion';
import { pageTransformFixture } from '#testing/page-transform';

function create(title: string, text: string) {
  return Effect.flatMap(Pages, (docs) =>
    docs.create({
      createKey: crypto.randomUUID(),
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

function target(version: PageVersion) {
  return {
    pageId: version.pageId,
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
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
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
            pageId: document.id,
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
          const scope = { pageId: document.id, keepLatest: 1 };
          const preview = yield* docs.previewHistory(scope);

          f.context.db.exec(
            "CREATE TRIGGER reject_retirement BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected'); END"
          );
          yield* Effect.flip(docs.retireHistory({ ...scope, token: preview.token }));
          assert.ok(
            (yield* docs.annotation({ id: hidden.annotation.id })).note ===
              'Retained note on retired body'
          );
          assert.strictEqual(
            (yield* docs.annotations({ pageId: document.id, includeDeleted: false, limit: 10 }))
              .items.length,
            3
          );
          f.context.db.exec('DROP TRIGGER reject_retirement');
          yield* docs.retireHistory({ ...scope, token: preview.token });

          return {
            pageId: document.id,
            hidden: hidden.annotation.id,
            moved: moved.annotation.id,
            sibling: sibling.annotation.id
          };
        }).pipe(Effect.provide(f.domain()))
      );
      const visible = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            assert.ok(
              (yield* Effect.flip(docs.annotation({ id: saved.hidden }))).kind === 'not_found'
            );
            const first = yield* docs.annotations({
              pageId: saved.pageId,
              includeDeleted: false,
              limit: 1
            });

            expect(first.items.map((item) => item.id)).toStrictEqual([saved.sibling]);
            assert.strictEqual(first.nextCursor, saved.sibling);
            const second = yield* docs.annotations({
              pageId: saved.pageId,
              includeDeleted: false,
              limit: 1,
              cursor: first.nextCursor!
            });

            expect(second.items.map((item) => item.id)).toStrictEqual([saved.moved]);
            assert.ok(second.nextCursor === null);
            const history = yield* docs.annotationHistory({ id: saved.moved, limit: 1 });

            assert.strictEqual(history.items[0]?.revision, 3n);
            assert.strictEqual(history.nextCursor, 3n);
            const prior = yield* docs.annotationHistory({
              id: saved.moved,
              limit: 10,
              cursor: history.nextCursor!
            });

            expect(prior.items.map((item) => [item.revision, item.note])).toStrictEqual([
              [2n, 'Revised note'],
              [1n, 'Retained original note']
            ]);
            assert.ok(prior.nextCursor === null);
          }).pipe(Effect.provide(f.domain()))
        );

      await visible();
      await f.reopen();
      await visible();
      assert.strictEqual(
        f.context.db.orm.select().from(s.page_annotation_revisions).all().length,
        5
      );
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

for (const mode of ['delete', 'prune'] as const)
  testStable(
    `${mode} removes claim-owned judgments atomically while unrelated exact assessments remain`,
    async () => {
      const f = await pageTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;
            const evidence = yield* create('Evidence', 'Evidence passage');
            const input = { kind: 'page' as const, versionId: evidence.version.id };
            const evidenceRange = {
              blockId: evidence.version.document.blocks[0]!.id,
              start: 0,
              end: 8
            };
            const claims = [];

            for (const note of ['Removed judgment', 'Retained judgment']) {
              const claim = yield* docs.create({
                createKey: crypto.randomUUID(),
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
                pageId: removed.id,
                expectedVersionId: removed.version.id,
                key: 'advance',
                document: deletionDocument('Current claim')
              });

            return { removed, kept: claims[1]! };
          }).pipe(Effect.provide(f.domain()))
        );
        const retire = () =>
          Effect.gen(function* () {
            const docs = yield* Pages;

            if (mode === 'delete') {
              const preview = yield* docs.previewDeletion({ id: saved.removed.id });

              yield* docs.delete({ pageId: saved.removed.id, token: preview.token });
            } else {
              const scope = { pageId: saved.removed.id, keepLatest: 1 };
              const preview = yield* docs.previewHistory(scope);

              yield* docs.retireHistory({ ...scope, token: preview.token });
            }
          }).pipe(Effect.provide(f.domain()));

        f.context.db.exec(
          "CREATE TRIGGER reject_retirement BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected'); END"
        );
        await expect(Effect.runPromise(retire())).rejects.toSatisfy(() => true);
        assert.strictEqual(
          f.context.db.orm.select().from(s.page_citation_assessments).all().length,
          2
        );
        await f.reopen();
        f.context.db.exec('DROP TRIGGER reject_retirement');
        await Effect.runPromise(retire());
        await f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            assert.ok(
              (yield* Effect.flip(
                docs.assessments({ versionId: saved.removed.version.id, marker: 1, limit: 10 })
              )).kind === 'not_found'
            );
            const kept = yield* docs.assessments({
              versionId: saved.kept.version.id,
              marker: 1,
              limit: 10
            });

            assert.ok(kept.items[0]?.state === 'assessed');
            assert.ok(kept.items[0]?.assessment.note === 'Retained judgment');
          }).pipe(Effect.provide(f.domain()))
        );
        assert.strictEqual(
          f.context.db.orm.select().from(s.page_citation_assessments).all().length,
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
      const f = await pageTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;
            const evidence = yield* create('Evidence', 'Evidence passage');
            const input = { kind: 'page' as const, versionId: evidence.version.id };
            const range = { blockId: evidence.version.document.blocks[0]!.id, start: 0, end: 8 };
            const citation = {
              marker: 1,
              input,
              anchor: { type: 'authored' as const },
              target: range,
              quote: 'Evidence'
            };
            const claim = yield* docs.create({
              createKey: crypto.randomUUID(),
              title: 'Claim',
              document: deletionDocument('Claim [1]'),
              inputs: [input],
              citations: [citation]
            });

            assert.ok(claim.version);

            if (mode === 'prune')
              yield* docs.save({
                pageId: evidence.id,
                expectedVersionId: evidence.version.id,
                key: 'new-evidence',
                document: deletionDocument('New evidence')
              });

            const blocked =
              mode === 'delete'
                ? yield* docs.previewDeletion({ id: evidence.id })
                : yield* docs.previewHistory({ pageId: evidence.id, keepLatest: 1 });

            expect(blocked.blockedVersionIds).toStrictEqual([evidence.version.id]);
            const rejected =
              mode === 'delete'
                ? docs.delete({ pageId: evidence.id, token: blocked.token })
                : docs.retireHistory({
                    pageId: evidence.id,
                    keepLatest: 1,
                    token: blocked.token
                  });

            assert.ok((yield* Effect.flip(rejected)).kind === 'invalid_input');
            const intent = {
              pageId: claim.id,
              expectedVersionId: claim.version.id,
              key: 'edit',
              document: deletionDocument('Edited [1]')
            };
            const edit = yield* docs.save(intent);

            expect(yield* docs.save(intent)).toStrictEqual({ ...edit, replayed: true });
            const conflict = yield* docs.save({ ...intent, key: 'conflict' });

            assert.ok(conflict.outcome === 'conflict');
            const restored = yield* docs.restore({
              pageId: claim.id,
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

              expect(v.inputs).toStrictEqual([input]);
              expect(v.citations).toStrictEqual([citation]);
            }

            const removeClaim = yield* docs.previewDeletion({ id: claim.id });

            yield* docs.delete({ pageId: claim.id, token: removeClaim.token });
            const preview =
              mode === 'delete'
                ? yield* docs.previewDeletion({ id: evidence.id })
                : yield* docs.previewHistory({ pageId: evidence.id, keepLatest: 1 });

            expect(preview.blockedVersionIds).toStrictEqual([]);

            if (mode === 'delete')
              yield* docs.delete({ pageId: evidence.id, token: preview.token });
            else
              yield* docs.retireHistory({
                pageId: evidence.id,
                keepLatest: 1,
                token: preview.token
              });

            return { evidence, input, citation };
          }).pipe(Effect.provide(f.domain()))
        );

        await f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            assert.ok(
              (yield* Effect.flip(docs.version({ id: saved.evidence.version.id }))).kind ===
                'not_found'
            );
            assert.ok(
              (yield* Effect.flip(
                docs.create({
                  createKey: crypto.randomUUID(),
                  title: 'No resurrection',
                  document: deletionDocument('Claim'),
                  inputs: [saved.input],
                  citations: [saved.citation]
                })
              )).kind === 'not_found'
            );

            if (mode === 'prune') {
              const current = yield* docs.page({ id: saved.evidence.id });

              assert.ok(current.version);
              assert.ok(
                (yield* Effect.flip(
                  docs.restore({
                    pageId: current.id,
                    expectedVersionId: current.version.id,
                    restoreVersionId: saved.evidence.version.id,
                    key: 'no-retired-restore'
                  })
                )).kind === 'not_found'
              );
            }
          }).pipe(Effect.provide(f.domain()))
        );
        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
