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

/** Apply the trusted caller scope and requested kinds before any candidate is ranked. */
function isEligible(
  row: SearchProjection,
  input: SemanticSearchInput,
  scope: SearchScope
): boolean {
  const kind = row.target.type === 'registered' ? row.target.entity : row.target.type;

  if (input.kinds && !input.kinds.includes(kind)) return false;

  if (scope.type === 'all') return true;

  return row.projectIds.some((id) => scope.projectIds.includes(id));
}

/** Filter each SQL page before fingerprinting without retaining unrelated projection text. */
function* eligibleProjections(
  rows: Iterable<SearchProjection>,
  input: SemanticSearchInput,
  scope: SearchScope
) {
  for (const row of rows) if (isEligible(row, input, scope)) yield row;
}

type SearchCandidate = Pick<SearchRecord, 'target' | 'title'> & {
  readonly projection: Pick<SearchProjection, 'target'>;
};

/** Choose each entity’s closest chunk with deterministic ordering before applying the result limit. */
function bestHits(
  ranked: readonly { key: string; distance: number }[],
  eligible: Map<string, SearchCandidate>,
  limit: number
) {
  const hits: Array<Omit<SemanticSearchHit, 'text'> & { key: string }> = [];
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
      key: match.key,
      distance: match.distance
    });

    if (hits.length === limit) break;
  }

  return hits;
}

/** Keep cached vectors subordinate to current feature visibility and model identity. */
export function makeVectorStore(db: Db, model: EmbeddingModel) {
  /** Read cache metadata without loading embedding blobs during stale-record reconciliation. */
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

  /** Delete removed, superseded, or incompatible excerpts before inference can fail or be interrupted. */
  function purge(rows: Iterable<SearchProjection>) {
    const live = new Map(
      Array.from(
        searchEntities(rows, model.maxChunkingInputLength),
        (row) => [row.target, row.fingerprint] as const
      )
    );
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

  /** Compare only this bounded record batch with persisted fingerprints and model settings. */
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

  /** Revalidate entity fingerprints inside the caller’s transaction before upserting inferred vectors. */
  function publish(
    batch: readonly SearchRecord[],
    vectors: readonly Float32Array[],
    rows: Iterable<SearchProjection>
  ) {
    const live = new Map(
      Array.from(
        searchEntities(rows, model.maxChunkingInputLength),
        (row) => [row.target, row.fingerprint] as const
      )
    );
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

  /** Use sqlite-vec cosine distance on bounded eligible key batches without loading vectors into JavaScript. */
  function score(keys: readonly string[], vector: Buffer) {
    return db.orm.all<{ key: string; distance: number }>(
      sql`SELECT key,vec_distance_cosine(embedding,${vector}) AS distance FROM ${entries} WHERE key IN (${sql.join(
        keys.map((key) => sql`${key}`),
        sql`,`
      )}) ORDER BY distance,key`
    );
  }

  /** Exclude invisible or stale records before ranking, deduplicating entities, and enforcing the limit. */
  function search(
    input: SemanticSearchInput,
    scope: SearchScope,
    query: Float32Array,
    rows: Iterable<SearchProjection>
  ) {
    const vector = vectorBuffer(query, model.dimensions);
    const live = new Map(
      Array.from(
        searchEntities(eligibleProjections(rows, input, scope), model.maxChunkingInputLength),
        (row) =>
          [
            row.target,
            {
              target: row.target,
              fingerprint: row.fingerprint,
              title: row.title,
              projection: { target: row.projection.target }
            }
          ] as const
      )
    );

    if (!live.size) return [];

    const saved = db.orm
      .select({
        key: entries.key,
        target: entries.target,
        fingerprint: entries.fingerprint
      })
      .from(entries)
      .where(
        and(
          eq(entries.model, model.identity),
          eq(entries.dimensions, model.dimensions),
          input.kinds ? inArray(entries.kind, [...input.kinds]) : undefined
        )
      )
      .all();
    const eligible = new Map<string, SearchCandidate>();

    for (const row of saved) {
      const entity = live.get(row.target);

      if (!entity || entity.fingerprint !== row.fingerprint) continue;

      eligible.set(row.key, entity);
    }

    const candidates = [...eligible.keys()];
    const ranked: Array<{ key: string; distance: number }> = [];

    for (let i = 0; i < candidates.length; i += 200)
      ranked.push(...score(candidates.slice(i, i + 200), vector));

    const selected = bestHits(ranked, eligible, input.limit ?? 10);

    if (!selected.length) return [];

    // Excerpts are loaded only after scope, freshness, deduplication and the limit are applied.
    const excerpts = new Map(
      db.orm
        .select({ key: entries.key, text: entries.text })
        .from(entries)
        .where(
          inArray(
            entries.key,
            selected.map((hit) => hit.key)
          )
        )
        .all()
        .map((row) => [row.key, row.text] as const)
    );

    return selected.map(({ key, ...hit }): SemanticSearchHit => ({
      ...hit,
      text: excerpts.get(key)!
    }));
  }

  return { purge, changed, publish, search };
}
