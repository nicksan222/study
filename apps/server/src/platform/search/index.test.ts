/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides typed semantic search infrastructure for local retrieval.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps search inputs validated and retrieval results bounded.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses injected capabilities without registering agents or application runtime services.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { projectIdSchema } from '@study/contracts/ids';
import { semantic_search_entries } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { makeSemanticIndex } from './index.ts';
import type { EmbeddingModel, SearchProjection } from './types.ts';

const id = Schema.decodeUnknownSync(projectIdSchema);

const model: EmbeddingModel = {
  chunkPassages: (text) =>
    Effect.succeed(
      Array.from({ length: Math.max(1, Math.ceil(text.length / 1000)) }, (_, i) =>
        text.slice(i * 1000, i * 1000 + 1200)
      )
    ),
  identity: 'fixture-v1',
  dimensions: 3,
  embedQuery: () => Effect.succeed(new Float32Array([1, 0, 0])),
  embedPassages: (texts) =>
    Effect.succeed(
      texts.map((text) => new Float32Array(text.includes('planet') ? [1, 0, 0] : [0, 1, 0]))
    )
};

const project = (n: bigint, text: string): SearchProjection => ({
  target: { type: 'project', id: id(n) },
  title: text,
  text,
  projectIds: [id(n)],
  revision: text
});

testStable(
  'real sqlite-vec ranks scoped results, reconciles edits and deletions, and survives reopening',
  async () => {
    const location = createTestDatabase();
    let db = location.open();
    let rows = [
      project(1n, 'planet science'),
      project(2n, 'planet biology'),
      project(3n, 'painting')
    ];

    try {
      let index = makeSemanticIndex({ db, model, read: () => rows });

      expect(await Effect.runPromise(index.reconcile())).toMatchObject({ embedded: 3 });
      expect(await Effect.runPromise(index.reconcile())).toMatchObject({ embedded: 0 });
      const found = await Effect.runPromise(
        index.search(
          { query: 'orbital motion', limit: 1 },
          { type: 'projects', projectIds: [id(2n)] }
        )
      );

      expect(found.map((hit) => hit.target)).toStrictEqual([{ type: 'project', id: id(2n) }]);
      rows = [project(1n, 'painting'), project(2n, 'planet biology')];
      // Visibility checks precede ranking/limit even before background reconciliation.
      expect(
        await Effect.runPromise(
          index.search({ query: 'orbital motion' }, { type: 'projects', projectIds: [id(3n)] })
        )
      ).toStrictEqual([]);
      expect(await Effect.runPromise(index.reconcile())).toMatchObject({ embedded: 1, removed: 1 });
      db.close();
      db = location.open();
      index = makeSemanticIndex({ db, model, read: () => rows });
      expect(await Effect.runPromise(index.reconcile())).toMatchObject({ embedded: 0 });
      expect(
        (await Effect.runPromise(index.search({ query: 'orbit' }, { type: 'all' })))[0]?.target
      ).toStrictEqual({ type: 'project', id: id(2n) });
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable('stale in-flight embeddings cannot replace current content', async () => {
  const location = createTestDatabase();
  const db = location.open();
  let rows = [project(1n, 'old planet')];
  const changing: EmbeddingModel = {
    ...model,
    embedPassages: (texts) =>
      Effect.sync(() => {
        rows = [project(1n, 'new painting')];

        return texts.map(() => new Float32Array([1, 0, 0]));
      })
  };

  try {
    const index = makeSemanticIndex({ db, model: changing, read: () => rows });

    expect(await Effect.runPromise(index.reconcile())).toMatchObject({ embedded: 0 });
    expect(await Effect.runPromise(index.search({ query: 'old' }, { type: 'all' }))).toStrictEqual(
      []
    );
  } finally {
    db.close();
    location.cleanup();
  }
});

testStable(
  'reconciliation scrubs deleted and edited excerpts before inference failure',
  async () => {
    const location = createTestDatabase();
    const db = location.open();
    let rows = [project(1n, 'planet'), project(2n, 'old painting')];

    try {
      const initial = makeSemanticIndex({ db, model, read: () => rows });

      await Effect.runPromise(initial.reconcile());
      rows = [project(2n, 'new planet')];
      const failing = {
        ...model,
        embedPassages: () => Effect.fail(new StudyError('transient', 'busy'))
      };
      const index = makeSemanticIndex({ db, model: failing, read: () => rows });
      const result = await Effect.runPromise(Effect.result(index.reconcile()));

      expect(result._tag).toBe('Failure');
      expect(db.orm.select().from(semantic_search_entries).all()).toStrictEqual([]);
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable(
  'multiple chunks deduplicate entities and scoped ranking fills limits beyond two hundred records',
  async () => {
    const location = createTestDatabase();
    const db = location.open();
    const rows = Array.from({ length: 220 }, (_, n) => project(BigInt(n + 1), 'planet ' + n));

    rows.push(project(221n, 'planet '.repeat(500)));

    try {
      const index = makeSemanticIndex({ db, model, read: () => rows });

      expect((await Effect.runPromise(index.reconcile())).embedded).toBeGreaterThan(221);
      const hits = await Effect.runPromise(
        index.search(
          { query: 'orbit', limit: 2 },
          { type: 'projects', projectIds: [id(220n), id(221n)] }
        )
      );

      expect(hits).toHaveLength(2);
      expect(
        new Set(
          hits.map((hit) =>
            JSON.stringify(hit.target, (_, value) =>
              typeof value === 'bigint' ? String(value) : value
            )
          )
        ).size
      ).toBe(2);
    } finally {
      db.close();
      location.cleanup();
    }
  }
);
