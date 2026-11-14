/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines typed SQLite stores with schema-validated synchronous queries and          │
 * │ mutations. It binds implementations to each ServerContext, requires transaction views    │
 * │ for writes, and publishes workflow events through the commit guard.                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports StoreResources, storeQuery, storeMutation, defineStore, Transaction, and       │
 * │   related typed APIs. It binds implementations to each ServerContext, requires           │
 * │   transaction views for writes, and publishes workflow events through the commit guard.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules use this typed declaration helper; it checks contracts but leaves domain │
 * │ data and business policy in the feature.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { WorkflowEvent } from '@study/contracts/events';
import type { Db, DbTransaction } from '@study/db';
import type { Clock, Context } from 'effect';
import { Effect, Option, Schema } from 'effect';

import type { ServerContext, ServerTransactionContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { normalizeError } from '#server/platform/errors/classify-error';
import { observeOperation, observeSyncOperation } from '#server/platform/observability/index';
import { emitEvent } from '#server/platform/workflows/events';
import { PublicationGuard } from '#server/platform/workflows/publication';

export type StoreResources = {
  readonly db: Db | DbTransaction;
  /** Operational time for eligibility, scheduling, and deadlines. */
  readonly clock: Clock.Clock;
  /** Persisted presentation timestamps; defaults to the operational clock. */
  readonly timestampClock: Clock.Clock;
};

type Decoder = Schema.ConstraintDecoder<unknown>;

type Definition<I extends Decoder, O extends Decoder> = {
  input: I;
  output: O;
  run: (input: I['Type']) => O['Type'];
};

type AnyDefinition = {
  input: Decoder;
  output: Decoder;
  run: (input: never) => unknown;
};

type Definitions = Record<string, AnyDefinition>;

const bindStore = Symbol('bindStore');

const readStore = Symbol('readStore');

const queryBrand: unique symbol = Symbol('storeQuery');

const mutationBrand: unique symbol = Symbol('storeMutation');

type QueryDefinition = AnyDefinition & {
  readonly [queryBrand]: true;
  readonly role: 'required' | 'optional' | 'collection';
};

type MutationDefinition = AnyDefinition & { readonly [mutationBrand]: true };

type SyncMethods<D extends Definitions> = {
  [K in keyof D]: D[K] extends { input: infer I extends Decoder; output: infer O extends Decoder }
    ? (input: I['Type']) => O['Type']
    : never;
};

type EffectMethods<D extends Definitions> = {
  [K in keyof D]: D[K] extends { input: infer I extends Decoder; output: infer O extends Decoder }
    ? (input: I['Type']) => Effect.Effect<O['Type'], StudyError>
    : never;
};

export function storeQuery<I extends Decoder, O extends Decoder>(
  definition: Omit<Definition<I, O>, 'run'> &
    (
      | {
          role: 'required';
          run: (input: I['Type']) => O['Type'] | null | undefined;
        }
      | {
          role: 'optional' | 'collection';
          run: (input: I['Type']) => O['Type'];
        }
    )
) {
  return { ...definition, [queryBrand]: true as const };
}

export function storeMutation<I extends Decoder, O extends Decoder>(definition: Definition<I, O>) {
  return { ...definition, [mutationBrand]: true as const };
}

function synchronous(value: unknown): unknown {
  if (
    Effect.isEffect(value) ||
    (value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof (value as { then?: unknown }).then === 'function')
  )
    throw new TypeError('Store operations and transaction callbacks must be synchronous');

  return value;
}

function execute(definition: AnyDefinition, input: unknown) {
  const decoded = decodeStoreInput(definition.input, input);

  return Schema.decodeUnknownSync(definition.output)(synchronous(definition.run(decoded as never)));
}

export function defineStore<
  Q extends Record<string, QueryDefinition>,
  M extends Record<string, MutationDefinition>
>(definition: {
  name: string;
  entity: { singular: string; plural: string };
  make: (resources: StoreResources) => { queries: Q; mutations: M };
}) {
  if (
    !definition.name.trim() ||
    !/^[a-z][a-zA-Z0-9]*$/.test(definition.entity.singular) ||
    !/^[a-z][a-zA-Z0-9]*$/.test(definition.entity.plural) ||
    definition.entity.singular === definition.entity.plural
  )
    throw new TypeError('Invalid store descriptor');

  const implementations = new WeakMap<
    ServerContext | ServerTransactionContext,
    { queries: Q; mutations: M }
  >();

  function validateOperationShapes(bound: { queries: Q; mutations: M }) {
    for (const [name, operation] of Object.entries({
      ...bound.queries,
      ...bound.mutations
    })) {
      if (
        !/^[a-z][a-zA-Z0-9]*$/.test(name) ||
        !operation ||
        !Schema.isSchema(operation.input) ||
        !Schema.isSchema(operation.output) ||
        typeof operation.run !== 'function'
      )
        throw new TypeError(`Invalid store operation ${name}`);
    }
  }

  function validateMutationDescriptors(bound: { queries: Q; mutations: M }) {
    for (const operation of Object.values(bound.mutations)) {
      if (operation[mutationBrand] !== true || queryBrand in operation)
        throw new TypeError('Mutations require storeMutation descriptors');
    }
  }

  function validateQueryDescriptors(bound: { queries: Q; mutations: M }) {
    for (const [name, operation] of Object.entries(bound.queries)) {
      if (operation[queryBrand] !== true || mutationBrand in operation)
        throw new TypeError('Queries require storeQuery descriptors');

      if (Object.hasOwn(bound.mutations, name)) throw new TypeError(`Duplicate operation ${name}`);

      const role = operation.role;

      if (!['required', 'optional', 'collection'].includes(role))
        throw new TypeError(`Invalid query role ${role}`);
    }
  }

  function operations(context: ServerContext | ServerTransactionContext) {
    const existing = implementations.get(context);

    if (existing) return existing;

    const bound = definition.make({
      db: context.db,
      clock: context.clock,
      timestampClock: context.timestampClock
    });

    synchronous(bound);

    if (!bound || !bound.queries || !bound.mutations)
      throw new TypeError('Store construction must return queries and mutations');

    validateOperationShapes(bound);
    validateMutationDescriptors(bound);
    validateQueryDescriptors(bound);

    implementations.set(context, bound);

    return bound;
  }

  function runQuery(operation: QueryDefinition, input: unknown) {
    const role = operation.role;
    const decoded = decodeStoreInput(operation.input, input);

    if (role === 'collection') assertCollectionLimit(decoded);

    const result = synchronous(operation.run(decoded as never));

    if (role === 'required' && result == null)
      throw new StudyError('not_found', `${definition.entity.singular} not found`);

    if (role === 'collection') assertCollectionResult(result, (decoded as { limit: number }).limit);

    if (role === 'optional' && !Option.isOption(result))
      throw new TypeError('Optional queries must return Option');

    return Schema.decodeUnknownSync(operation.output)(result);
  }

  function make(context: ServerContext): EffectMethods<Q> {
    return Object.fromEntries(
      Object.entries(operations(context).queries).map(([name, operation]) => [
        name,
        (input: unknown) =>
          observeOperation(
            `${definition.name}.${name}`,
            Effect.try({ try: () => runQuery(operation, input), catch: normalizeError })
          )
      ])
    ) as EffectMethods<Q>;
  }

  function bind(
    context: ServerContext | ServerTransactionContext,
    active: () => boolean,
    instrument: <A>(name: string, run: () => A) => A
  ): SyncMethods<Q & M> {
    const bound = operations(context);

    return Object.fromEntries(
      Object.entries({ ...bound.queries, ...bound.mutations }).map(([name, operation]) => [
        name,
        (input: never) => {
          if (!active()) throw new Error('Transaction is no longer active');

          return instrument(`${definition.name}.${name}`, () =>
            name in bound.queries
              ? runQuery(bound.queries[name]!, input)
              : execute(operation, input)
          );
        }
      ])
    ) as SyncMethods<Q & M>;
  }

  return { [readStore]: make, [bindStore]: bind };
}

type StoreDefinition = {
  [bindStore]: (
    context: ServerContext | ServerTransactionContext,
    active: () => boolean,
    instrument: <A>(name: string, run: () => A) => A
  ) => object;
};

export type SyncResult<T> = T extends
  | PromiseLike<unknown>
  | Effect.Effect<unknown, unknown, unknown>
  ? never
  : T;

const transactionDatabases = new WeakMap<Transaction, DbTransaction>();

export function transactionDatabase(tx: Transaction): DbTransaction {
  const database = transactionDatabases.get(tx);

  if (!database) throw new Error('Transaction is no longer active');

  return database;
}

export type Transaction = {
  store<S extends StoreDefinition>(store: S): ReturnType<S[typeof bindStore]>;
  emit(event: WorkflowEvent): void;
  assertPublication(guard: PublicationGuard['Service']): void;
  transaction<T>(work: (tx: Transaction) => T & SyncResult<T>): T;
};

export function useStore<S extends { [readStore]: (context: ServerContext) => object }>(
  store: S
): Effect.Effect<ReturnType<S[typeof readStore]>, StudyError, Database> {
  return Database.use(({ store: context }) =>
    Effect.try({
      try: () => store[readStore](context) as ReturnType<S[typeof readStore]>,
      catch: normalizeError
    })
  );
}

function runTransaction<T>(
  context: ServerContext | ServerTransactionContext,
  effectContext: Context.Context<never>,
  work: (tx: Transaction) => T,
  guard?: PublicationGuard['Service']
): T {
  return context.transaction((transactionContext) => {
    if (Object.prototype.toString.call(work) === '[object AsyncFunction]')
      throw new TypeError('Transaction callbacks must be synchronous');

    guard?.assert(transactionContext);

    let active = true;

    try {
      function store<S extends StoreDefinition>(definition: S): ReturnType<S[typeof bindStore]> {
        if (!active) throw new Error('Transaction is no longer active');

        return definition[bindStore](
          transactionContext,
          () => active,
          (name, run) => observeSyncOperation(effectContext, name, run)
        ) as ReturnType<S[typeof bindStore]>;
      }

      const emit = (event: WorkflowEvent) => {
        if (!active) throw new Error('Transaction is no longer active');

        emitEvent(transactionContext, event, transactionContext.clock.currentTimeMillisUnsafe());
      };
      const assertPublication = (publication: PublicationGuard['Service']) => {
        if (!active) throw new Error('Transaction is no longer active');

        publication.assert(transactionContext);
      };
      const nested = <A>(callback: (tx: Transaction) => A & SyncResult<A>) => {
        if (!active) throw new Error('Transaction is no longer active');

        return runTransaction(transactionContext, effectContext, callback, guard);
      };
      const view = { store, emit, assertPublication, transaction: nested };

      transactionDatabases.set(view, transactionContext.db);
      const value = work(view);

      synchronous(value);

      return value;
    } finally {
      active = false;
    }
  });
}

function transactionEffect<T>(
  work: (tx: Transaction) => T,
  guard?: PublicationGuard['Service']
): Effect.Effect<T, StudyError, Database> {
  return observeOperation(
    'store.transaction',
    Database.use(({ store: context }) =>
      Effect.withFiber((fiber) =>
        Effect.try({
          try: () => runTransaction<T>(context, fiber.context, work, guard),
          catch: normalizeError
        })
      )
    )
  );
}

export function transaction<T>(
  work: (tx: Transaction) => T & SyncResult<T>
): Effect.Effect<T, StudyError, Database> {
  return Effect.serviceOption(PublicationGuard).pipe(
    Effect.flatMap((guard) => transactionEffect<T>(work, Option.getOrUndefined(guard)))
  );
}

/** Assert the current activity owner inside the same transaction as publication. */
export function publicationTransaction<T>(
  work: (tx: Transaction) => T & SyncResult<T>
): Effect.Effect<T, StudyError, Database | PublicationGuard> {
  return PublicationGuard.use((guard) => transactionEffect<T>(work, guard));
}

function assertCollectionLimit(decoded: unknown) {
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !('limit' in decoded) ||
    typeof decoded.limit !== 'number' ||
    !Number.isSafeInteger(decoded.limit) ||
    decoded.limit < 1 ||
    decoded.limit > 1000
  )
    throw new TypeError('Collection queries require a bounded limit');
}

function assertCollectionResult(result: unknown, limit: number) {
  const items = Array.isArray(result)
    ? result
    : result !== null &&
        typeof result === 'object' &&
        'items' in result &&
        ('next' in result || 'nextCursor' in result)
      ? result.items
      : undefined;

  if (!Array.isArray(items))
    throw new TypeError('Collection queries must return an array or a page');

  if (items.length > limit) throw new TypeError('Collection result exceeds its requested limit');
}

function decodeStoreInput<S extends Decoder>(schema: S, input: unknown): S['Type'] {
  try {
    return Schema.decodeUnknownSync(schema)(input);
  } catch (cause) {
    if (Schema.isSchemaError(cause))
      throw new StudyError('invalid_input', 'Invalid operation input', { cause });

    throw cause;
  }
}
