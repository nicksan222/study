/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides typed semantic retrieval and registry integration for local application   │
 * │ content.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves entity identities and keeps retrieval bounded and scoped.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own visibility while injected embedding capabilities provide local   │
 * │ inference.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { projectIdSchema } from '@study/contracts/ids';
import { sql } from '@study/db';
import * as schema from '@study/db/schema';
import { integer, text, defineTable } from '@study/db/schema-builder';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { LocalEmbeddings } from '#server/platform/ai/embeddings/local';
import { installEmbeddingModel } from '#server/platform/ai/embeddings/model';
import { makeSearchTools } from '#server/platform/ai/search-tool';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { SearchConfiguration } from '#server/platform/search/configuration';
import { SearchStorage } from '#server/platform/search/storage';

import { Search } from './index.ts';

const topics = defineTable({
  role: 'entity',
  projection: 'columns',
  scope: { type: 'global' },
  visibility: 'all',
  kind: 'topic',
  description: 'Saved subject headings',
  textColumns: ['name']
})('test_topics', { id: integer().primaryKey(), name: text().notNull() });

testStable(
  'a newly declared entity is discovered, embedded and searchable without an indexer registration',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      context.db.exec('CREATE TABLE test_topics (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      context.db.orm
        .insert(topics)
        .values([
          { id: 1, name: 'Le piante trasformano la luce solare in energia con la fotosintesi.' },
          { id: 2, name: 'I treni partono dalla stazione ferroviaria.' }
        ])
        .run();
      await Effect.runPromise(installEmbeddingModel('target/embedding-model'));
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const model = yield* LocalEmbeddings.open('target/embedding-model');
            const service = yield* Search.pipe(
              Effect.provide(Search.layer),
              Effect.provide(SearchStorage.layer),
              Effect.provideService(SearchConfiguration, { model, schema: { ...schema, topics } }),
              Effect.provideService(Database, { store: context })
            );

            expect((yield* service.catalog()).some((entity) => entity.kind === 'topic')).toBe(true);
            expect((yield* service.catalog()).some((entity) => entity.kind === 'preferences')).toBe(
              false
            );
            expect(yield* service.reconcile()).toMatchObject({ embedded: 2 });
            const tools = makeSearchTools(service, { type: 'all' });
            const environment = { language: 'en', searchSources: () => Effect.succeed([]) };
            const hits = yield* tools.search.execute(
              { query: 'How do plants convert sunshine into energy?', kinds: ['topic'], limit: 1 },
              environment
            );

            expect(hits).toMatchObject([
              { target: { type: 'registered', entity: 'topic', key: '1' } }
            ]);
            expect(
              (yield* tools.listSearchableEntities.execute({}, environment)).some(
                (entry) => entry.kind === 'topic'
              )
            ).toBe(true);
            const before = yield* service.search(
              { query: 'sunshine', kinds: ['topic'] },
              { type: 'all' }
            );
            const oldExcerpt = before.find(
              (hit) => hit.target.type === 'registered' && hit.target.key === '1'
            )?.text;

            expect(oldExcerpt).toBeDefined();
            context.db.orm.run(
              sql`UPDATE test_topics SET name='Painting a portrait with oils' WHERE id=1`
            );
            const stale = yield* service.search(
              { query: 'sunshine', kinds: ['topic'] },
              { type: 'all' }
            );

            expect(stale.some((hit) => hit.text === oldExcerpt)).toBe(false);
            expect(yield* service.reconcile()).toMatchObject({ embedded: 1 });
            const updated = yield* service.search(
              { query: 'sunshine', kinds: ['topic'] },
              { type: 'all' }
            );

            expect(updated.some((hit) => hit.text === oldExcerpt)).toBe(false);
            expect(updated.some((hit) => hit.text.includes('Painting a portrait with oils'))).toBe(
              true
            );
            context.db.orm.run(sql`DELETE FROM test_topics WHERE id=2`);
            expect(yield* service.reconcile()).toMatchObject({ removed: 1 });
          })
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

const scopedTopics = defineTable({
  role: 'entity',
  projection: 'columns',
  kind: 'scoped-topic',
  description: 'Scoped notes',
  textColumns: ['name'],
  scope: { type: 'project', column: 'project_id' },
  visibility: {
    archivedColumn: 'archived_at',
    deletedColumn: 'deleted_at',
    publishedColumn: 'status',
    publishedValue: 'published'
  }
})('test_scoped_topics', {
  id: integer().primaryKey(),
  name: text().notNull(),
  project_id: integer().notNull(),
  archived_at: integer(),
  deleted_at: integer(),
  status: text().notNull()
});

testStable(
  'automatic table projections honor declared project scope, publication, archive and deletion',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const model = {
      chunkPassages: (text: string) => Effect.succeed([text]),
      identity: 'scope-fixture-v1',
      dimensions: 3,
      embedQuery: () => Effect.succeed(new Float32Array([1, 0, 0])),
      embedPassages: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Float32Array([1, 0, 0])))
    };

    try {
      context.db.exec(
        'CREATE TABLE test_scoped_topics(id INTEGER PRIMARY KEY,name TEXT NOT NULL,project_id INTEGER NOT NULL,archived_at INTEGER,deleted_at INTEGER,status TEXT NOT NULL)'
      );
      context.db.orm
        .insert(scopedTopics)
        .values([
          { id: 1, name: 'visible planet', project_id: 1, status: 'published' },
          { id: 2, name: 'other project', project_id: 2, status: 'published' },
          { id: 3, name: 'draft secret', project_id: 1, status: 'draft' },
          { id: 4, name: 'archived secret', project_id: 1, status: 'published', archived_at: 1 },
          { id: 5, name: 'deleted secret', project_id: 1, status: 'published', deleted_at: 1 }
        ])
        .run();
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Search;

          expect(yield* service.reconcile()).toMatchObject({ embedded: 2 });
          const hits = yield* service.search(
            { query: 'planet', kinds: ['scoped-topic'] },
            { type: 'projects', projectIds: [Schema.decodeUnknownSync(projectIdSchema)(1n)] }
          );

          expect(hits.map((hit) => hit.target)).toStrictEqual([
            { type: 'registered', entity: 'scoped-topic', key: '1' }
          ]);
          context.db.orm.run(sql`UPDATE test_scoped_topics SET project_id=2 WHERE id=1`);
          expect(
            yield* service.search(
              { query: 'planet', kinds: ['scoped-topic'] },
              { type: 'projects', projectIds: [Schema.decodeUnknownSync(projectIdSchema)(1n)] }
            )
          ).toStrictEqual([]);
        }).pipe(
          Effect.provide(Search.layer),
          Effect.provide(SearchStorage.layer),
          Effect.provideService(SearchConfiguration, {
            model,
            schema: { ...schema, scopedTopics }
          }),
          Effect.provideService(Database, { store: context })
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
