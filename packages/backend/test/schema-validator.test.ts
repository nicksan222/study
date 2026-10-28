import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initTRPC } from '@trpc/server';
import { Effect, Schema } from 'effect';

import { inputValidator as reconsentValidator } from '#backend/procedures/auth/start-chatgpt-sign-in/input';
import { inputValidator as llmSettingsValidator } from '#backend/procedures/settings/save-llm-settings/input';
import { asyncIterableOutputValidator } from '#backend/shared/schema-validator';

const t = initTRPC.create();

const emptyInputSchema = Schema.Struct({}).pipe(Schema.withDecodingDefault(Effect.succeed({})));

const emptyInputValidator = Schema.toStandardSchemaV1(emptyInputSchema);

const eventSchema = Schema.Struct({ type: Schema.Literal('refresh') });

const eventValidator = asyncIterableOutputValidator(eventSchema);

test('preserves omitted and explicit empty-object procedure inputs', async () => {
  const router = t.router({
    empty: t.procedure.input(emptyInputValidator).query(({ input }) => input)
  });
  const caller = router.createCaller({});

  assert.deepEqual(await caller.empty(), {});
  assert.deepEqual(await caller.empty({}), {});
});

test('preserves Zod optional and defaulted field semantics in a real tRPC caller', async () => {
  const router = t.router({
    reconsent: t.procedure.input(reconsentValidator).query(({ input }) => input),
    settings: t.procedure.input(llmSettingsValidator).query(({ input }) => input)
  });
  const caller = router.createCaller({});

  assert.deepEqual(await caller.reconsent({}), { reconsent: false });
  assert.deepEqual(await caller.reconsent({ reconsent: undefined }), { reconsent: false });
  assert.deepEqual(
    await caller.settings({
      tiny: { provider: 1 },
      medium: { provider: 1, model: undefined },
      smart: { provider: 1, model: 3 }
    }),
    {
      tiny: { provider: 1 },
      medium: { provider: 1, model: undefined },
      smart: { provider: 1, model: 3 }
    }
  );
  await assert.rejects(caller.reconsent({ reconsent: null } as never));
  await assert.rejects(
    caller.settings({
      tiny: { provider: 1, model: null },
      medium: { provider: 1, model: 2 },
      smart: { provider: 1, model: 3 }
    } as never)
  );
});

function eventRouter(source: () => AsyncIterable<{ readonly type: 'refresh' }>) {
  return t.router({
    events: t.procedure.output(eventValidator).subscription(source)
  });
}

test('validates each subscription event and preserves early iterator cleanup', async () => {
  let closed = false;
  const router = eventRouter(async function* () {
    try {
      yield { type: 'refresh' };
      yield { type: 'refresh' };
    } finally {
      closed = true;
    }
  });
  const stream: AsyncIterable<{ readonly type: 'refresh' }> = await router
    .createCaller({})
    .events();
  const iterator = stream[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), { done: false, value: { type: 'refresh' } });
  await iterator.return?.();
  assert.equal(closed, true);
});

test('does not close an iterator after normal exhaustion', async () => {
  let returnCalls = 0;
  const source: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true as const, value: undefined }),
        return: async () => {
          returnCalls += 1;

          throw new Error('unexpected cleanup failure');
        }
      };
    }
  };
  const result = await eventValidator['~standard'].validate(source);

  assert.ok('value' in result);
  const iterator = result.value[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  assert.equal(returnCalls, 0);
});

test('rejects invalid yielded subscription events', async () => {
  const invalidEvents = (async function* () {
    yield { type: 'other' };
  })();
  const result = await eventValidator['~standard'].validate(invalidEvents);

  assert.ok('value' in result);
  const iterator = result.value[Symbol.asyncIterator]();

  await assert.rejects(iterator.next(), /Output validation failed/);
});

test('preserves an invalid event error when generator cleanup also fails through a caller', async () => {
  const router = eventRouter(() => {
    let yielded = false;

    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (yielded) return { done: true as const, value: undefined };

            yielded = true;

            return { done: false as const, value: { type: 'other' } as never };
          },
          return: async () => {
            throw new Error('cleanup failed');
          }
        };
      }
    };
  });
  const stream = await router.createCaller({}).events();

  await assert.rejects(stream[Symbol.asyncIterator]().next(), (error: Error) => {
    assert.match(error.message, /Output validation failed/);
    assert.doesNotMatch(error.message, /cleanup failed/);

    return true;
  });
});

test('preserves a source failure when iterator cleanup also fails', async () => {
  const sourceFailure = new Error('source failed');
  const cleanupFailure = new Error('cleanup failed');
  const source: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(sourceFailure),
        return: () => Promise.reject(cleanupFailure)
      };
    }
  };
  const result = await eventValidator['~standard'].validate(source);

  assert.ok('value' in result);
  await assert.rejects(result.value[Symbol.asyncIterator]().next(), (error: Error) => {
    assert.equal(error, sourceFailure);

    return true;
  });
});
