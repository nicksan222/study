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

import type { StudyError } from '@study/contracts/errors';
import { Context, Effect, Layer } from 'effect';

import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import type { SyncResult, Transaction } from '#server/platform/definitions/define-store';

import { makeSemanticIndex } from './index.ts';

type IndexOptions = Omit<
  Parameters<typeof makeSemanticIndex>[0],
  'db' | 'read' | 'transaction' | 'beforePublish'
>;

export class SearchStorage extends Context.Service<
  SearchStorage,
  {
    readonly open: (options: IndexOptions) => ReturnType<typeof makeSemanticIndex>;
    readonly transaction: <A>(work: (tx: Transaction) => A) => Effect.Effect<A, StudyError>;
  }
>()('study/search/Storage') {
  static readonly layer = Layer.effect(
    SearchStorage,
    Effect.map(Database, (database) => ({
      open: (options: IndexOptions) => makeSemanticIndex({ ...options, db: database.store.db }),
      transaction: <A>(work: (tx: Transaction) => A) =>
        transaction<A>((tx) => work(tx) as A & SyncResult<A>).pipe(
          Effect.provideService(Database, database)
        )
    }))
  );
}
