/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies edits retain and renumber surviving citation evidence while leaving       │
 * │ historical message versions unchanged.                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts citation anchors survive edits and prior message versions remain immutable.    │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { citations } from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Projects } from '#server/features/projects/index';
import { createStudyTest } from '#testing/server-test';

import { Notes } from './index.ts';

testStable(
  'edits preserve and renumber surviving citation evidence without changing historical versions',
  async (t) => {
    const fixture = await createStudyTest(t);

    await fixture.run(
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Citations' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({
          project: project.id,
          title: 'Evidence'
        });
        const original = yield* notes.postMessage({
          noteId: note.id,
          text: 'First [1], second [2], third [3].'
        });

        assert.ok(original.activeVersionId);

        for (const marker of [1, 2, 3])
          fixture.store.db.orm
            .insert(citations)
            .values({
              version_id: original.activeVersionId,
              marker: BigInt(marker),
              source_id: null,
              source_name: `Source ${marker}`,
              anchor: JSON.stringify({ type: 'page', page: marker }),
              quote: `Evidence ${marker}`
            })
            .run();

        const edited = yield* notes.editMessage({
          messageId: original.id,
          text: 'Keep [3] and [1, 3].'
        });

        assert.ok(
          edited.versions.find((version) => version.id === edited.activeVersionId)?.text ===
            'Keep [2] and [1, 2].'
        );
        expect(
          edited.citations.map(({ marker, sourceName, anchor, quote }) => ({
            marker,
            sourceName,
            anchor,
            quote
          }))
        ).toStrictEqual([
          {
            marker: 1,
            sourceName: 'Source 1',
            anchor: { type: 'page', page: 1 },
            quote: 'Evidence 1'
          },
          {
            marker: 2,
            sourceName: 'Source 3',
            anchor: { type: 'page', page: 3 },
            quote: 'Evidence 3'
          }
        ]);
        const exact = yield* notes.messageVersionCitations({
          noteId: note.id,
          messageId: original.id,
          versionId: original.activeVersionId
        });

        expect(exact.citations.map((c) => c.marker)).toStrictEqual([1, 2, 3]);
        assert.ok(exact.citations.every((c) => c.evidence?.availability === 'unavailable'));
        assert.strictEqual(
          (yield* notes.message(original.id)).activeVersionId,
          edited.activeVersionId
        );
        expect(
          (yield* notes.messageVersionCitations({
            noteId: note.id,
            messageId: original.id,
            versionId: edited.activeVersionId!
          })).citations
        ).toStrictEqual(edited.citations);
        const other = yield* notes.createNote({ title: 'Other' });

        assert.ok(
          (yield* Effect.flip(
            notes.messageVersionCitations({
              noteId: other.id,
              messageId: original.id,
              versionId: original.activeVersionId
            })
          )).kind === 'not_found'
        );
        const noteMessage = yield* notes.postMessage({
          noteId: note.id,
          text: 'No evidence'
        });

        assert.ok(
          (yield* Effect.flip(
            notes.messageVersionCitations({
              noteId: note.id,
              messageId: original.id,
              versionId: noteMessage.activeVersionId!
            })
          )).kind === 'not_found'
        );
        expect(
          (yield* notes.messageVersionCitations({
            noteId: note.id,
            messageId: noteMessage.id,
            versionId: noteMessage.activeVersionId!
          })).citations
        ).toStrictEqual([]);
        const historical = yield* notes.setActiveVersion({
          messageId: original.id,
          versionId: original.activeVersionId
        });

        assert.strictEqual(historical.citations.length, 3);
        yield* notes.deleteMessage(noteMessage.id);
        assert.ok(
          (yield* Effect.flip(
            notes.messageVersionCitations({
              noteId: note.id,
              messageId: noteMessage.id,
              versionId: noteMessage.activeVersionId!
            })
          )).kind === 'not_found'
        );
        assert.strictEqual(
          historical.versions.find((version) => version.id === historical.activeVersionId)?.text,
          original.versions[0]?.text
        );
      })
    );
  }
);
