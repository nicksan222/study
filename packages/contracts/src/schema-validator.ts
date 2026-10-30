import { Schema } from 'effect';
import type { StandardSchemaV1 } from 'effect/StandardSchema';

/**
 * Wrap an Effect event schema as a tRPC output parser for async-generator
 * subscriptions. tRPC parses the resolver result once, so validation must wrap
 * the iterable and check each event as it is consumed.
 */
export function asyncIterableOutputValidator<S extends Schema.ConstraintDecoder<unknown>>(
  eventSchema: S
): StandardSchemaV1<AsyncIterable<S['Encoded']>, AsyncIterable<S['Type']>> {
  const eventValidator = Schema.toStandardSchemaV1(eventSchema);

  return {
    '~standard': {
      version: 1,
      vendor: 'effect',
      validate(value) {
        if (!isAsyncIterable(value))
          return {
            issues: [{ message: 'Expected an async iterable of subscription events' }]
          };

        return {
          value: validateEvents(value, eventValidator)
        };
      }
    }
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  );
}

async function* validateEvents<S extends Schema.ConstraintDecoder<unknown>>(
  source: AsyncIterable<unknown>,
  validator: ReturnType<typeof Schema.toStandardSchemaV1<S>>
): AsyncGenerator<S['Type']> {
  const iterator = source[Symbol.asyncIterator]();
  let failed = false;
  let exhausted = false;

  try {
    while (true) {
      const next = await iterator.next();

      if (next.done) {
        exhausted = true;

        return;
      }

      const result = await validator['~standard'].validate(next.value);

      if (result.issues !== undefined)
        throw new Error(
          `Output validation failed: ${result.issues.map(({ message }) => message).join('; ')}`
        );

      yield result.value;
    }
  } catch (error) {
    failed = true;

    throw error;
  } finally {
    if (!exhausted) {
      if (failed) await closeAfterFailure(iterator);
      else await iterator.return?.();
    }
  }
}

async function closeAfterFailure(iterator: AsyncIterator<unknown>): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // Keep the source or validation error as the failure observed by the caller.
  }
}
