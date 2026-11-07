/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed feature capabilities and native │
 * │ workflows.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves current publication identities and validates searchable entity projections.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime registration remains explicit and feature services own all content visibility    │
 * │ rules.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type {
  SearchProjection,
  SearchProjectionPage,
  SearchProjectionPageInput,
  SearchTarget
} from '@study/contracts/search/schemas';
import { Effect, Option, Stream } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { makeRegistryStore } from '#server/features/search/store/registry';
import { Sources } from '#server/features/sources/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import { SearchConfiguration } from '#server/platform/search/configuration';
import { SearchStorage } from '#server/platform/search/storage';

type ProjectionReader = (tx: Transaction, input: SearchProjectionPageInput) => SearchProjectionPage;

const featureReaders: ReadonlyMap<string, ProjectionReader> = new Map([
  ['project', Projects.searchProjectionsInTransaction],
  ['session', Conversations.searchProjectionsInTransaction],
  ['message', Conversations.searchProjectionsInTransaction],
  ['source', Sources.searchProjectionsInTransaction],
  ['passage', Sources.searchProjectionsInTransaction],
  ['material', Materials.searchProjectionsInTransaction],
  ['question', Materials.searchProjectionsInTransaction],
  ['document', Documents.searchProjectionsInTransaction]
]);

export const Search = defineService(
  'study/Search',
  Effect.gen(function* () {
    const storage = yield* SearchStorage;
    const configuration = yield* SearchConfiguration;
    const registry = makeRegistryStore({
      schema: configuration.schema,
      featureKinds: new Set(featureReaders.keys())
    });
    const registryStore = registry.store;
    const readColumns: ProjectionReader = (tx, input) =>
      tx.store(registryStore).searchProjectionPages(input);

    /** Consume SQL pages inside the transaction without retaining the entire corpus text. */
    function* read(
      tx: Transaction,
      targets?: readonly SearchTarget[]
    ): Generator<SearchProjection> {
      for (const entry of registry.projections) {
        if (
          targets &&
          !targets.some(
            (target) => (target.type === 'registered' ? target.entity : target.type) === entry.kind
          )
        )
          continue;

        const reader =
          entry.projection === 'feature' ? featureReaders.get(entry.kind)! : readColumns;
        let offset = 0;

        for (;;) {
          const page = reader(tx, { offset, limit: 1000, kind: entry.kind, targets });

          yield* page.items;

          if (page.next === null) break;

          offset = page.next;
        }
      }
    }

    /** Read visibility and mutate the index within the same synchronous database transaction. */
    const commit = <A>(
      work: (rows: Iterable<SearchProjection>) => A,
      beforePublish?: () => void,
      targets?: readonly SearchTarget[]
    ) =>
      storage.transaction<A>((tx) => {
        beforePublish?.();

        return work(read(tx, targets));
      });
    /** Read one bounded page; publication later revalidates its targets in a transaction. */
    const readPage = (kind: string, reader: ProjectionReader, offset: number) =>
      storage.transaction((tx) => {
        const page = reader(tx, { offset, limit: 1000, kind });

        return [[page.items], Option.fromNullishOr(page.next)] as const;
      });
    // Concurrent additions or offset shifts are recovered by the next reconciliation pass.
    const pages = Stream.fromIterable(registry.projections).pipe(
      Stream.flatMap((entry) => {
        const reader =
          entry.projection === 'feature' ? featureReaders.get(entry.kind)! : readColumns;

        return Stream.paginate(0, (offset) => readPage(entry.kind, reader, offset));
      })
    );
    /** Keep publication fences configurable without registering a runtime worker or agent. */
    const makeIndex = (beforePublish?: () => void) =>
      storage.open({
        model: configuration.model,
        pages,
        commit: (work, targets) => commit(work, beforePublish, targets)
      });
    const index = makeIndex();

    return {
      catalog: () => Effect.succeed(registry.catalog),
      search: index.search,
      reconcile: (beforePublish?: () => void) => makeIndex(beforePublish).reconcile()
    };
  })
);
