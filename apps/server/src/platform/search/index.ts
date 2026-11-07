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
import { Effect, Schema, Stream } from 'effect';

import { normalizeError } from '#server/platform/errors/classify-error';

import { searchEntities, searchRecord } from './records.ts';
import type { SearchRecord, SearchEntity } from './records.ts';
import { makeVectorStore } from './store.ts';
import { textWindows } from './text-windows.ts';
import type { EmbeddingModel, SearchScope } from './types.ts';

type SearchCommit = <A>(
  work: (rows: Iterable<SearchProjection>) => A,
  targets?: readonly SearchTarget[]
) => Effect.Effect<A, StudyError>;

/** Build an opt-in index whose publication always revalidates current feature visibility. */
export function makeSemanticIndex(options: {
  db: Db;
  model: EmbeddingModel;
  read?: () => readonly SearchProjection[];
  pages?: Stream.Stream<readonly SearchProjection[], StudyError>;
  commit?: SearchCommit;
  beforePublish?: () => void;
}) {
  const { db, model } = options;
  const sync = <A>(work: () => A) => Effect.try({ try: work, catch: normalizeError });
  const pages = options.pages ?? Stream.fromEffect(sync(() => options.read!()));
  const commit: SearchCommit =
    options.commit ??
    (<A>(work: (rows: Iterable<SearchProjection>) => A) =>
      sync(() =>
        db.transaction(() => {
          options.beforePublish?.();

          return work(options.read!());
        })
      ));
  const store = makeVectorStore(db, model);

  if (!Number.isSafeInteger(model.dimensions) || model.dimensions < 1 || !model.identity.trim())
    throw new StudyError('config', 'Invalid embedding model identity');

  if (!Number.isSafeInteger(model.maxChunkingInputLength) || model.maxChunkingInputLength < 2)
    throw new StudyError('config', 'Invalid embedding chunking limit');

  /** Keep ordinals continuous across windows while retaining only one window's chunks. */
  function entityRecords(entity: SearchEntity) {
    return Stream.fromIterable(textWindows(entity.text, model.maxChunkingInputLength)).pipe(
      Stream.mapEffect((text) => model.chunkPassages(text)),
      Stream.flatMap((chunks) => Stream.fromIterable(chunks)),
      Stream.mapAccum(
        () => 0,
        (ordinal, text) => [ordinal + 1, [searchRecord(entity, text, ordinal)]] as const
      )
    );
  }

  /** Run inference outside the transaction and fence each result against current projections. */
  function publishBatch(batch: readonly SearchRecord[]) {
    return Effect.gen(function* () {
      const vectors = yield* model.embedPassages(batch.map((row) => row.text));

      if (vectors.length !== batch.length)
        return yield* Effect.fail(new StudyError('internal', 'Embedding batch length mismatch'));

      return yield* commit(
        (rows) => store.publish(batch, vectors, rows),
        batch.map((row) => row.projection.target)
      );
    });
  }

  /** Purge stale excerpts before inference, then publish bounded, restartable batches. */
  function reconcile() {
    return Effect.gen(function* () {
      const removed = yield* commit(store.purge);
      const embedded = yield* pages.pipe(
        Stream.flatMap((rows) =>
          Stream.fromIterable(searchEntities(rows, model.maxChunkingInputLength))
        ),
        Stream.flatMap(entityRecords),
        Stream.grouped(200),
        Stream.mapEffect((records) => sync(() => store.changed(records))),
        Stream.flatMap((records) => Stream.fromIterable(records)),
        Stream.grouped(16),
        Stream.mapEffect(publishBatch),
        Stream.runFold(
          () => 0,
          (total, count) => total + count
        )
      );

      return { embedded, removed };
    });
  }

  /** Embed a validated query and restrict ranking to currently visible, authorized entities. */
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
