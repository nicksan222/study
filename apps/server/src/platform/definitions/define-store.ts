import { StudyError } from '@study/contracts/errors';
import type { Db } from '@study/db';
import type { Clock } from 'effect';
import { Context, Effect, Layer, Option, Schema } from 'effect';

import type { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { classifyError } from '#server/platform/errors/classify-error';
import { observeOperation, observeSyncOperation } from '#server/platform/observability/index';

export type StoreResources = { readonly db: Db; readonly clock: Clock.Clock };

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
  return definition;
}

export function storeMutation<I extends Decoder, O extends Decoder>(definition: Definition<I, O>) {
  return definition;
}

function failure(error: unknown): StudyError {
  if (error instanceof StudyError) return error;

  const result = classifyError(error);

  return new StudyError(result.kind, result.message, {
    cause: error,
    retryAfterMs: result.retryAfterMs
  });
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
  const decoded = Schema.decodeUnknownSync(definition.input)(input);

  return Schema.decodeUnknownSync(definition.output)(synchronous(definition.run(decoded as never)));
}

export function defineStore<Q extends Definitions, M extends Definitions>(definition: {
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

  const implementations = new WeakMap<ServerContext, { queries: Q; mutations: M }>();

  function operations(context: ServerContext) {
    const existing = implementations.get(context);

    if (existing) return existing;

    const bound = definition.make({ db: context.db, clock: context.clock });

    synchronous(bound);

    if (!bound || !bound.queries || !bound.mutations)
      throw new TypeError('Store construction must return queries and mutations');

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

    for (const [name, operation] of Object.entries(bound.queries)) {
      if (Object.hasOwn(bound.mutations, name)) throw new TypeError(`Duplicate operation ${name}`);

      const role = (operation as AnyDefinition & { role: string }).role;

      if (!['required', 'optional', 'collection'].includes(role))
        throw new TypeError(`Invalid query role ${role}`);

      const singular = definition.entity.singular;
      const expected =
        role === 'required'
          ? singular
          : role === 'optional'
            ? `find${singular[0]?.toUpperCase()}${singular.slice(1)}`
            : definition.entity.plural;

      if (name !== expected) throw new TypeError(`Query ${name} must be named ${expected}`);
    }

    implementations.set(context, bound);

    return bound;
  }

  function runQuery(operation: AnyDefinition, input: unknown) {
    const role = (operation as AnyDefinition & { role: string }).role;
    const decoded = Schema.decodeUnknownSync(operation.input)(input);

    if (
      role === 'collection' &&
      (!decoded ||
        typeof decoded !== 'object' ||
        !('limit' in decoded) ||
        typeof decoded.limit !== 'number' ||
        !Number.isSafeInteger(decoded.limit) ||
        decoded.limit < 1 ||
        decoded.limit > 1000)
    )
      throw new TypeError('Collection queries require a bounded limit');

    const result = synchronous(operation.run(decoded as never));

    if (role === 'required' && result == null)
      throw new StudyError('not_found', `${definition.entity.singular} not found`);

    if (role === 'collection') {
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

      if (items.length > (decoded as { limit: number }).limit)
        throw new TypeError('Collection result exceeds its requested limit');
    }

    if (role === 'optional' && !Option.isOption(result))
      throw new TypeError('Optional queries must return Option');

    return Schema.decodeUnknownSync(operation.output)(result);
  }

  const key = Context.Service<EffectMethods<Q>>(definition.name);

  function make(context: ServerContext): EffectMethods<Q> {
    return Object.fromEntries(
      Object.entries(operations(context).queries).map(([name, operation]) => [
        name,
        (input: unknown) =>
          observeOperation(
            `${definition.name}.${name}`,
            Effect.try({ try: () => runQuery(operation, input), catch: failure })
          )
      ])
    ) as EffectMethods<Q>;
  }

  const layer = Layer.effect(
    key,
    Effect.map(Database, ({ store }) => make(store))
  );

  function bind(
    context: ServerContext,
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
            name in bound.queries ? runQuery(operation, input) : execute(operation, input)
          );
        }
      ])
    ) as SyncMethods<Q & M>;
  }

  return { key, layer, make, [bindStore]: bind };
}

type StoreDefinition = {
  [bindStore]: (
    context: ServerContext,
    active: () => boolean,
    instrument: <A>(name: string, run: () => A) => A
  ) => object;
};

type SyncResult<T> = T extends PromiseLike<unknown> | Effect.Effect<unknown, unknown, unknown>
  ? never
  : T;

export function transaction<T>(
  context: ServerContext,
  work: (tx: {
    store<S extends StoreDefinition>(store: S): ReturnType<S[typeof bindStore]>;
  }) => T & SyncResult<T>
): Effect.Effect<T, StudyError> {
  return observeOperation(
    'store.transaction',
    Effect.withFiber((fiber) =>
      Effect.try({
        try: () =>
          context.transaction(() => {
            let active = true;

            try {
              function store<S extends StoreDefinition>(
                definition: S
              ): ReturnType<S[typeof bindStore]> {
                return definition[bindStore](
                  context,
                  () => active,
                  (name, run) => observeSyncOperation(fiber.context, name, run)
                ) as ReturnType<S[typeof bindStore]>;
              }

              const value = work({ store });

              synchronous(value);

              return value;
            } finally {
              active = false;
            }
          }),
        catch: failure
      })
    )
  );
}
