/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies published source search projections against real SQLite database records. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises version publication, scope changes and anchored passage retrieval.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses temporary database files and the feature search projection without running models.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { deletionDocument } from '#testing/material-deletion';

import { makeDocumentSearchProjections } from './search.ts';

testStable('authored projections use only the visible published document head', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const documents = yield* Documents;
        const document = yield* documents.create({
          createKey: 'semantic-projection',
          title: 'Notes',
          document: deletionDocument('Obsolete text'),
          inputs: [],
          citations: []
        });

        expect(
          makeDocumentSearchProjections({ db: context.db, clock: context.clock })()[0]?.text
        ).toContain('Obsolete text');
        yield* documents.save({
          documentId: document.id,
          expectedVersionId: document.version!.id,
          key: 'edit-semantic-projection',
          document: deletionDocument('Current text')
        });
        const entries = makeDocumentSearchProjections({ db: context.db, clock: context.clock })();

        expect(entries).toHaveLength(1);
        expect(entries[0]?.text).toContain('Current text');
        expect(entries[0]?.text).not.toContain('Obsolete text');
        const read = makeDocumentSearchProjections({ db: context.db, clock: context.clock });

        expect(
          read({
            kind: 'document',
            offset: 0,
            limit: 1,
            targets: entries.map((entry) => entry.target)
          })
        ).toStrictEqual(entries);
        expect(read({ kind: 'document', offset: 1, limit: 1 })).toStrictEqual([]);
        expect(read({ kind: 'document', offset: 0, limit: 1, targets: [] })).toStrictEqual([]);

        yield* documents.archive({ id: document.id, archived: true });
        expect(
          makeDocumentSearchProjections({ db: context.db, clock: context.clock })()
        ).toStrictEqual([]);
      }).pipe(Effect.provide(Documents.layer), Effect.provideService(Database, { store: context }))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
