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

import { StudyError } from '@study/contracts/errors';
import type {
  SearchProjection,
  SearchTarget,
  SemanticSearchInput
} from '@study/contracts/search/schemas';
import { semanticSearchInputSchema } from '@study/contracts/search/schemas';
import type { Db } from '@study/db';
import { Effect, Schema } from 'effect';

import { normalizeError } from '#server/platform/errors/classify-error';

import { searchEntities, searchRecord } from './records.ts';
import type { SearchRecord } from './records.ts';
import { makeVectorStore } from './store.ts';
import type { EmbeddingModel, SearchScope } from './types.ts';

type SearchCommit = <A>(
  work: (rows: readonly SearchProjection[]) => A,
  targets?: readonly SearchTarget[]
) => Effect.Effect<A, StudyError>;

export function makeSemanticIndex(options: {
  db: Db;
  model: EmbeddingModel;
  read?: () => readonly SearchProjection[];
  snapshot?: () => Effect.Effect<readonly SearchProjection[], StudyError>;
  commit?: SearchCommit;
  beforePublish?: () => void;
}) {
  const { db, model } = options;
  const sync = <A>(work: () => A) => Effect.try({ try: work, catch: normalizeError });
  const snapshot = options.snapshot ?? (() => sync(() => options.read!()));
  const commit: SearchCommit =
    options.commit ??
    (<A>(work: (rows: readonly SearchProjection[]) => A) =>
      sync(() =>
        db.transaction(() => {
          options.beforePublish?.();

          return work(options.read!());
        })
      ));
  const store = makeVectorStore(db, model);

  if (!Number.isSafeInteger(model.dimensions) || model.dimensions < 1 || !model.identity.trim())
    throw new StudyError('config', 'Invalid embedding model identity');

  function reconcile() {
    return Effect.gen(function* () {
      // Scrub removed or superseded excerpts before any model work can fail or be interrupted.
      const removed = yield* commit(store.purge);
      const desired = yield* snapshot();
      const entities = yield* sync(() => searchEntities(desired));
      const records: SearchRecord[] = [];

      for (const entity of entities) {
        const chunks = yield* model.chunkPassages(entity.text);

        for (let i = 0; i < chunks.length; i++) records.push(searchRecord(entity, chunks[i]!, i));
      }

      const changed = yield* sync(() => store.changed(records));
      let embedded = 0;

      for (let offset = 0; offset < changed.length; offset += 16) {
        const batch = changed.slice(offset, offset + 16);
        const vectors = yield* model.embedPassages(batch.map((row) => row.text));

        if (vectors.length !== batch.length)
          return yield* Effect.fail(new StudyError('internal', 'Embedding batch length mismatch'));

        embedded += yield* commit(
          (rows) => store.publish(batch, vectors, rows),
          batch.map((row) => row.projection.target)
        );
      }

      return { embedded, removed };
    });
  }

  function search(input: SemanticSearchInput, scope: SearchScope) {
    return Effect.gen(function* () {
      const request = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(semanticSearchInputSchema)(input),
        catch: (cause) =>
          new StudyError('invalid_input', 'Invalid semantic search input', { cause })
      });

      if (!request.query.trim())
        return yield* Effect.fail(
          new StudyError('invalid_input', 'Search query must not be blank')
        );

      if (scope.type === 'projects' && !scope.projectIds.length) return [];

      const query = yield* model.embedQuery(request.query);

      return yield* commit((rows) => store.search(request, scope, query, rows));
    });
  }

  return { reconcile, search };
}
