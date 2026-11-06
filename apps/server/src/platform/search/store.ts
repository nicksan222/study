/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed capabilities and durable        │
 * │ workflow resources.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves entity identities and keeps retrieval scoped and bounded.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own visibility and runtime registration remains an explicit caller   │
 * │ decision.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type {
  SearchProjection,
  SemanticSearchHit,
  SemanticSearchInput
} from '@study/contracts/search/schemas';
import type { Db } from '@study/db';
import { and, eq, inArray, sql } from '@study/db';
import { semantic_search_entries as entries } from '@study/db/schema';

import { searchEntities, vectorBuffer } from './records.ts';
import type { SearchRecord } from './records.ts';
import type { EmbeddingModel, SearchScope } from './types.ts';

function isEligible(row: SearchRecord, input: SemanticSearchInput, scope: SearchScope): boolean {
  if (input.kinds && !input.kinds.includes(row.kind)) return false;

  if (scope.type === 'all') return true;

  return row.projection.projectIds.some((id) => scope.projectIds.includes(id));
}

function bestHits(
  ranked: readonly { key: string; distance: number }[],
  eligible: Map<string, SearchRecord>,
  limit: number
) {
  const hits: SemanticSearchHit[] = [];
  const seen = new Set<string>();

  for (const match of [...ranked].sort(
    (a, b) => a.distance - b.distance || a.key.localeCompare(b.key)
  )) {
    const row = eligible.get(match.key)!;

    if (seen.has(row.target)) continue;

    seen.add(row.target);
    hits.push({
      target: row.projection.target,
      title: row.title,
      text: row.text,
      distance: match.distance
    });

    if (hits.length === limit) break;
  }

  return hits;
}

export function makeVectorStore(db: Db, model: EmbeddingModel) {
  function persisted() {
    return db.orm
      .select({
        key: entries.key,
        target: entries.target,
        fingerprint: entries.fingerprint,
        model: entries.model,
        dimensions: entries.dimensions
      })
      .from(entries)
      .all();
  }

  function purge(rows: readonly SearchProjection[]) {
    const live = new Map(searchEntities(rows).map((row) => [row.target, row.fingerprint]));
    const stale = persisted().filter(
      (row) =>
        live.get(row.target) !== row.fingerprint ||
        row.model !== model.identity ||
        Number(row.dimensions) !== model.dimensions
    );

    for (let i = 0; i < stale.length; i += 200)
      db.orm
        .delete(entries)
        .where(
          inArray(
            entries.key,
            stale.slice(i, i + 200).map((row) => row.key)
          )
        )
        .run();

    return stale.filter((row) => !live.has(row.target)).length;
  }

  function changed(desired: readonly SearchRecord[]) {
    const saved = new Map<string, { fingerprint: string; model: string; dimensions: number }>();

    for (let i = 0; i < desired.length; i += 200) {
      const keys = desired.slice(i, i + 200).map((row) => row.key);
      const rows = db.orm
        .select({
          key: entries.key,
          fingerprint: entries.fingerprint,
          model: entries.model,
          dimensions: entries.dimensions
        })
        .from(entries)
        .where(inArray(entries.key, keys))
        .all();

      for (const row of rows) saved.set(row.key, row);
    }

    return desired.filter((row) => {
      const old = saved.get(row.key);

      return (
        !old ||
        old.fingerprint !== row.fingerprint ||
        old.model !== model.identity ||
        Number(old.dimensions) !== model.dimensions
      );
    });
  }

  function publish(
    batch: readonly SearchRecord[],
    vectors: readonly Float32Array[],
    rows: readonly SearchProjection[]
  ) {
    const live = new Map(searchEntities(rows).map((row) => [row.target, row.fingerprint]));
    let count = 0;

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]!;

      if (live.get(row.target) !== row.fingerprint) continue;

      const value = {
        key: row.key,
        kind: row.kind,
        target: row.target,
        fingerprint: row.fingerprint,
        model: model.identity,
        dimensions: model.dimensions,
        title: row.title,
        text: row.text,
        embedding: vectorBuffer(vectors[i]!, model.dimensions)
      };

      db.orm
        .insert(entries)
        .values(value)
        .onConflictDoUpdate({ target: entries.key, set: value })
        .run();
      count++;
    }

    return count;
  }

  function score(keys: readonly string[], vector: Buffer) {
    return db.orm.all<{ key: string; distance: number }>(
      sql`SELECT key,vec_distance_cosine(embedding,${vector}) AS distance FROM ${entries} WHERE key IN (${sql.join(
        keys.map((key) => sql`${key}`),
        sql`,`
      )}) ORDER BY distance,key`
    );
  }

  function search(
    input: SemanticSearchInput,
    scope: SearchScope,
    query: Float32Array,
    rows: readonly SearchProjection[]
  ) {
    const vector = vectorBuffer(query, model.dimensions);
    const live = new Map(searchEntities(rows).map((row) => [row.target, row]));
    const saved = db.orm
      .select({
        key: entries.key,
        target: entries.target,
        fingerprint: entries.fingerprint,
        text: entries.text
      })
      .from(entries)
      .where(and(eq(entries.model, model.identity), eq(entries.dimensions, model.dimensions)))
      .all();
    const eligible = new Map<string, SearchRecord>();

    for (const row of saved) {
      const entity = live.get(row.target);

      if (!entity || entity.fingerprint !== row.fingerprint) continue;

      const record = { ...entity, key: row.key, text: row.text };

      if (isEligible(record, input, scope)) eligible.set(row.key, record);
    }

    const candidates = [...eligible.keys()];
    const ranked: Array<{ key: string; distance: number }> = [];

    for (let i = 0; i < candidates.length; i += 200)
      ranked.push(...score(candidates.slice(i, i + 200), vector));

    return bestHits(ranked, eligible, input.limit ?? 10);
  }

  return { purge, changed, publish, search };
}
