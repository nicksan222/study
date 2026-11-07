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
import type { SearchProjection } from '@study/contracts/search/schemas';
import type { Db } from '@study/db';
import { eq } from '@study/db';
import { semantic_search_entries } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Stream } from 'effect';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { makeSemanticIndex } from './index.ts';
import type { EmbeddingModel } from './types.ts';

const id = Schema.decodeUnknownSync(projectIdSchema);

const model: EmbeddingModel = {
  chunkPassages: (text) =>
    Effect.succeed(
      Array.from({ length: Math.max(1, Math.ceil(text.length / 1000)) }, (_, i) =>
        text.slice(i * 1000, i * 1000 + 1200)
      )
    ),
  maxChunkingInputLength: 2000000,
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

function targetedCommit(
  db: Db,
  rows: readonly SearchProjection[],
  windows: number[]
): NonNullable<Parameters<typeof makeSemanticIndex>[0]['commit']> {
  return (work, targets) =>
    Effect.sync(() =>
      db.transaction(() => {
        expect(targets).toBeDefined();
        windows.push(targets!.length);
        const ids = new Set<SearchProjection['projectIds'][number]>();

        for (const target of targets!) if (target.type === 'project') ids.add(target.id);

        const visible: SearchProjection[] = [];

        for (const row of rows)
          if (row.target.type === 'project' && ids.has(row.target.id)) visible.push(row);

        return work(visible);
      })
    );
}

testStable('reconciliation purges bounded target batches before failed inference', async () => {
  const location = createTestDatabase();
  const db = location.open();
  const original = Array.from({ length: 450 }, (_, n) => project(BigInt(n + 1), 'planet ' + n));
  const rows = [project(4n, 'updated painting'), ...original.slice(4)];
  const windows: number[] = [];

  try {
    await Effect.runPromise(makeSemanticIndex({ db, model, read: () => original }).reconcile());
    const index = makeSemanticIndex({
      db,
      model: { ...model, embedPassages: () => Effect.fail(new StudyError('transient', 'busy')) },
      read: () => rows,
      commit: targetedCommit(db, rows, windows)
    });
    const result = await Effect.runPromise(Effect.result(index.reconcile()));

    expect(result._tag).toBe('Failure');
    expect(windows.length).toBeGreaterThan(1);
    expect(Math.max(...windows)).toBeLessThanOrEqual(200);
    const retained = db.orm.select().from(semantic_search_entries).all();

    expect(retained).toHaveLength(446);
    expect(
      retained.some((row) => ['planet 0', 'planet 1', 'planet 2', 'planet 3'].includes(row.title))
    ).toBe(false);
  } finally {
    db.close();
    location.cleanup();
  }
});

testStable(
  'search revalidates cached rows after ranking before filling its result limit',
  async () => {
    const location = createTestDatabase();
    const db = location.open();
    const rows = [project(1n, 'planet winner'), project(2n, 'painting fallback')];

    try {
      await Effect.runPromise(makeSemanticIndex({ db, model, read: () => rows }).reconcile());
      const winner = db.orm
        .select()
        .from(semantic_search_entries)
        .all()
        .find((row) => row.title === 'planet winner')!;
      const index = makeSemanticIndex({
        db,
        model,
        read: () => rows,
        beforePublish: () => {
          db.orm
            .update(semantic_search_entries)
            .set({ fingerprint: 'superseded', text: 'unrelated replacement' })
            .where(eq(semantic_search_entries.key, winner.key))
            .run();
        }
      });

      expect(
        await Effect.runPromise(index.search({ query: 'planet', limit: 1 }, { type: 'all' }))
      ).toMatchObject([
        { target: { type: 'project', id: id(2n) }, text: 'painting fallback\npainting fallback' }
      ]);
      const removed = makeSemanticIndex({
        db,
        model,
        read: () => rows,
        beforePublish: () => {
          db.orm.delete(semantic_search_entries).run();
        }
      });

      expect(
        await Effect.runPromise(removed.search({ query: 'planet', limit: 1 }, { type: 'all' }))
      ).toStrictEqual([]);
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable(
  'search ranks before targeted visibility checks and widens past unauthorized candidates',
  async () => {
    const location = createTestDatabase();
    const db = location.open();
    const rows = Array.from({ length: 220 }, (_, n) =>
      project(BigInt(n + 1), n === 219 ? 'painting scoped' : 'planet ' + n)
    );
    const windows: number[] = [];

    try {
      await Effect.runPromise(makeSemanticIndex({ db, model, read: () => rows }).reconcile());
      const index = makeSemanticIndex({
        db,
        model,
        commit: targetedCommit(db, rows, windows)
      });
      const hits = await Effect.runPromise(
        index.search({ query: 'planet', limit: 1 }, { type: 'projects', projectIds: [id(220n)] })
      );

      expect(hits).toMatchObject([
        { target: { type: 'project', id: id(220n) }, text: 'painting scoped\npainting scoped' }
      ]);
      expect(windows[0]).toBeLessThan(rows.length);
      expect(windows.length).toBeGreaterThan(1);
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable('search reads passage text only for its selected result keys', async () => {
  const location = createTestDatabase();
  const db = location.open();
  const rows = [project(1n, 'planet winner'), project(2n, 'painting loser')];

  try {
    const index = makeSemanticIndex({ db, model, read: () => rows });

    await Effect.runPromise(index.reconcile());
    // SQLite evaluates this expression only if a query actually reads a losing excerpt.
    db.exec(`ALTER TABLE semantic_search_entries RENAME TO test_search_entries;
      CREATE VIEW semantic_search_entries AS
      SELECT key,kind,target,fingerprint,model,dimensions,title,embedding,
        CASE WHEN title='planet winner' THEN text ELSE json_extract('invalid-json','$') END AS text
      FROM test_search_entries;`);
    const hits = await Effect.runPromise(
      index.search({ query: 'planet', limit: 1 }, { type: 'all' })
    );

    expect(hits).toMatchObject([
      { target: { type: 'project', id: id(1n) }, text: 'planet winner\nplanet winner' }
    ]);
  } finally {
    db.close();
    location.cleanup();
  }
});

testStable('reconciliation publishes a bounded page before reading the next page', async () => {
  const location = createTestDatabase();
  const db = location.open();
  const rows = Array.from({ length: 1001 }, (_, n) => project(BigInt(n + 1), 'planet ' + n));
  let readLastPage = false;
  const pages = Stream.fromIterable([rows.slice(0, 1000), rows.slice(1000)]).pipe(
    Stream.tap((page) =>
      Effect.sync(() => {
        if (page.length === 1) {
          expect(db.orm.select().from(semantic_search_entries).all().length).toBeGreaterThan(0);
          readLastPage = true;
        }
      })
    )
  );

  try {
    const index = makeSemanticIndex({ db, model, read: () => rows, pages });

    expect(await Effect.runPromise(index.reconcile())).toStrictEqual({
      embedded: 1001,
      removed: 0
    });
    expect(readLastPage).toBe(true);
    expect(
      await Effect.runPromise(index.search({ query: 'planet', limit: 1 }, { type: 'all' }))
    ).toHaveLength(1);
  } finally {
    db.close();
    location.cleanup();
  }
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

testStable(
  'oversized entities retain ordered Unicode content and do not block other indexing',
  async () => {
    const location = createTestDatabase();
    const db = location.open();
    const maximum = 2000000;
    const body =
      'x'.repeat(65536 - 'Large\n'.length - 1) + '😀' + 'x'.repeat(maximum) + ' planet tail marker';
    const rows: SearchProjection[] = [
      { ...project(1n, body), title: 'Large', revision: '1' },
      project(2n, 'small planet')
    ];
    const windows: string[] = [];
    const bounded: EmbeddingModel = {
      ...model,
      maxChunkingInputLength: maximum,
      chunkPassages: (text) => {
        windows.push(text);

        return text.length > maximum
          ? Effect.fail(new StudyError('invalid_input', 'Chunking request too large'))
          : Effect.succeed([text]);
      }
    };

    try {
      const index = makeSemanticIndex({ db, model: bounded, read: () => rows });
      const result = await Effect.runPromise(index.reconcile());

      expect(result.embedded).toBe(windows.length);
      expect(result.embedded).toBeGreaterThan(2);
      expect(windows.every((text) => text.length <= maximum)).toBe(true);
      expect(
        windows.every(
          (text) =>
            !(text.charCodeAt(0) >= 0xdc00 && text.charCodeAt(0) <= 0xdfff) &&
            !(
              text.charCodeAt(text.length - 1) >= 0xd800 &&
              text.charCodeAt(text.length - 1) <= 0xdbff
            )
        )
      ).toBe(true);
      const indexed = db.orm
        .select()
        .from(semantic_search_entries)
        .all()
        .filter((row) => JSON.parse(row.target).id === '1')
        .sort((a, b) => Number(a.key.split(':').at(-1)) - Number(b.key.split(':').at(-1)));

      expect(indexed.map((row) => row.text).join('')).toBe('Large\n' + body);
      expect(indexed.map((row) => Number(row.key.split(':').at(-1)))).toStrictEqual(
        Array.from({ length: indexed.length }, (_, ordinal) => ordinal)
      );
      expect(await Effect.runPromise(index.reconcile())).toStrictEqual({
        embedded: 0,
        removed: 0
      });
      const hits = await Effect.runPromise(index.search({ query: 'planet' }, { type: 'all' }));

      expect(hits.some((hit) => hit.target.type === 'project' && hit.target.id === id(2n))).toBe(
        true
      );
      expect(
        hits.find((hit) => hit.target.type === 'project' && hit.target.id === id(1n))?.text
      ).toContain('planet tail marker');
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable(
  'changing the chunking limit invalidates cached ordinals without changing model identity',
  async () => {
    const location = createTestDatabase();
    const db = location.open();
    const rows = [project(1n, 'planet '.repeat(30))];
    const chunked: EmbeddingModel = {
      ...model,
      maxChunkingInputLength: 32,
      chunkPassages: (text) => Effect.succeed([text])
    };

    try {
      const initial = makeSemanticIndex({ db, model: chunked, read: () => rows });

      await Effect.runPromise(initial.reconcile());
      const previous = db.orm.select().from(semantic_search_entries).all();
      const larger = makeSemanticIndex({
        db,
        model: { ...chunked, maxChunkingInputLength: 80 },
        read: () => rows
      });

      expect(
        await Effect.runPromise(larger.search({ query: 'planet' }, { type: 'all' }))
      ).toStrictEqual([]);
      expect((await Effect.runPromise(larger.reconcile())).embedded).toBeGreaterThan(0);
      const current = db.orm.select().from(semantic_search_entries).all();

      expect(current.length).toBeLessThan(previous.length);
      expect(current.every((row) => row.fingerprint !== previous[0]!.fingerprint)).toBe(true);
      expect(
        await Effect.runPromise(larger.search({ query: 'planet' }, { type: 'all' }))
      ).toHaveLength(1);
      expect(await Effect.runPromise(larger.reconcile())).toStrictEqual({
        embedded: 0,
        removed: 0
      });
    } finally {
      db.close();
      location.cleanup();
    }
  }
);
