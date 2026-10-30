import assert from 'node:assert/strict';
import { test } from 'node:test';

import { citations } from '@study/db/schema';
import { Effect } from 'effect';

import { Projects } from '#server/features/projects/index';
import { createStudyTest } from '#testing/server-test';

import { Conversations } from './index.ts';

test('edits preserve and renumber surviving citation evidence without changing historical versions', async (t) => {
  const fixture = await createStudyTest(t);

  await fixture.run(
    Effect.gen(function* () {
      const project = yield* (yield* Projects).createProject({ name: 'Citations' });
      const conversations = yield* Conversations;
      const session = yield* conversations.createSession({
        project: project.id,
        title: 'Evidence'
      });
      const original = yield* conversations.postMessage({
        sessionId: session.id,
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

      const edited = yield* conversations.editMessage({
        messageId: original.id,
        text: 'Keep [3] and [1, 3].'
      });

      assert.equal(
        edited.versions.find((version) => version.id === edited.activeVersionId)?.text,
        'Keep [2] and [1, 2].'
      );
      assert.deepEqual(
        edited.citations.map(({ marker, sourceName, anchor, quote }) => ({
          marker,
          sourceName,
          anchor,
          quote
        })),
        [
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
        ]
      );
      const historical = yield* conversations.setActiveVersion({
        messageId: original.id,
        versionId: original.activeVersionId
      });

      assert.equal(historical.citations.length, 3);
      assert.equal(
        historical.versions.find((version) => version.id === historical.activeVersionId)?.text,
        original.versions[0]?.text
      );
    })
  );
});
