import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Effect, Schema } from 'effect';

type PureCodec = Schema.ConstraintCodec<unknown, unknown, never, never>;

interface Target {
  readonly id?: string;
  readonly input: PureCodec;
  readonly output: PureCodec;
  readonly mode?: 'text' | 'object';
}

interface Invocation {
  readonly definition: {
    readonly id?: string;
    readonly input: Schema.ConstraintDecoder<unknown>;
    readonly output: Schema.ConstraintDecoder<unknown>;
    readonly mode?: 'text' | 'object';
  };
  readonly input: unknown;
}

interface Plan {
  readonly definition: Target;
  readonly inputSchema: PureCodec;
  readonly outputSchema: PureCodec;
  readonly id?: string;
  state: 'queued' | 'reserved' | 'running' | 'settled';
  consume(input: unknown, signal?: AbortSignal): Promise<MockResult>;
}

interface MockResult {
  readonly value: unknown;
  readonly json: Schema.Json;
}

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((yes) => {
    resolve = yes;
  });

  return { promise, resolve };
}

const strict = { onExcessProperty: 'error' } as const;

function codec<S extends PureCodec>(schema: S) {
  const json = Schema.toCodecJson(schema);

  return {
    encode(value: unknown) {
      const decoded = Schema.decodeUnknownSync(Schema.toType(schema), strict)(value);

      return structuredClone(Schema.encodeSync(json, strict)(decoded));
    },
    decode(value: Schema.Json): S['Type'] {
      return Schema.decodeUnknownSync(json, strict)(value);
    }
  };
}

/** Object field order is irrelevant; arrays, absent fields and exact scalar values are not. */
function canonical(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`)
      .join(',')}}`;

  return JSON.stringify(value);
}

function sameTarget(plan: Plan, call: Invocation) {
  const target = call.definition;

  return (
    plan.inputSchema === target.input &&
    plan.outputSchema === target.output &&
    (plan.definition === target || (plan.id !== undefined && plan.id === target.id))
  );
}

async function wait(gate: Promise<void>, signal: AbortSignal | undefined, aborted: () => void) {
  if (!signal) return gate;

  let reject!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, no) => {
    reject = no;
  });
  const abort = () => {
    aborted();
    reject(signal.reason);
  };

  signal.addEventListener('abort', abort, { once: true });

  try {
    if (signal.aborted) abort();

    await Promise.race([gate, interrupted]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/**
 * Typed one-shot expectations for actual agent/tool definitions and decoded schema values.
 * Internal provider retries reuse their invocation's outcome. Unexpected and unused calls
 * fail verification; using scopes verify automatically. Registration requires concrete,
 * context-free schema codecs so fixture values can cross the provider JSON boundary.
 * Hold/release synchronizes tests
 * with real execution without sleeps or prompt matching.
 *
 * @example
 * using mock = createAiMock();
 * const next = mock.next(summaryAgent, { input, output, hold: true });
 * const app = await App.open({ path, ai: mock.runtime });
 * // Start the real application operation, then synchronize its provider boundary:
 * await next.called;
 * next.release();
 */
export function createAiMock() {
  const plans: Plan[] = [];
  const failures: Error[] = [];

  function fail(message: string, cause?: unknown): never {
    const error = new Error(message, { cause });

    failures.push(error);

    throw error;
  }

  function register<T extends Target>(
    target: T,
    input: T['input']['Type'],
    perform: () => MockResult,
    hold = false
  ) {
    const inputCodec = codec(target.input);
    const expectedInput = canonical(inputCodec.encode(input));
    const called = deferred<{ readonly input: T['input']['Type'] }>();
    const aborted = deferred<void>();
    const gate = deferred<void>();

    if (!hold) gate.resolve();

    const plan: Plan = {
      definition: target,
      inputSchema: target.input,
      outputSchema: target.output,
      id: target.id,
      state: 'queued',
      async consume(actual, signal) {
        let encoded: Schema.Json;

        try {
          encoded = inputCodec.encode(actual);
        } catch (cause) {
          return fail('AI mock received input outside the target schema', cause);
        }

        if (canonical(encoded) !== expectedInput)
          return fail('AI mock received unexpected input for the next call');

        plan.state = 'running';
        called.resolve({ input: inputCodec.decode(encoded) });

        try {
          await wait(gate.promise, signal, () => aborted.resolve());

          return perform();
        } finally {
          plan.state = 'settled';
        }
      }
    };

    plans.push(plan);

    return { called: called.promise, release: () => gate.resolve(), aborted: aborted.promise };
  }

  function reserve(call: Invocation) {
    const plan = plans.find(
      (candidate) => candidate.state === 'queued' && sameTarget(candidate, call)
    );

    if (!plan) return fail('AI mock received an unplanned agent or tool call');

    plan.state = 'reserved';

    return plan;
  }

  async function consume(call: Invocation, signal?: AbortSignal) {
    signal?.throwIfAborted();

    return reserve(call).consume(call.input, signal);
  }

  function model(call: Invocation): LanguageModelV3 {
    const plan = reserve(call);
    let outcome: Promise<MockResult> | undefined;
    const text = async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      // Provider retries belong to this logical invocation, never the next expectation.
      outcome ??= plan.consume(call.input, signal);
      const { json: encoded } = await outcome;

      signal?.throwIfAborted();

      if (call.definition.mode !== 'object' && typeof encoded !== 'string')
        return fail('Text agent mock output must encode as a string');

      return typeof encoded === 'string' && call.definition.mode !== 'object'
        ? encoded
        : JSON.stringify(encoded);
    };
    const usage = {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 }
    };

    return {
      specificationVersion: 'v3',
      provider: 'study-testing',
      modelId: 'typed-mock',
      supportedUrls: {},
      async doGenerate(options) {
        return {
          content: [{ type: 'text', text: await text(options.abortSignal) }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: []
        };
      },
      async doStream(options) {
        const output = await text(options.abortSignal);

        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'output' });
              controller.enqueue({ type: 'text-delta', id: 'output', delta: output });
              controller.enqueue({ type: 'text-end', id: 'output' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage
              });
              controller.close();
            }
          })
        };
      }
    };
  }

  function verify() {
    const unfinished = plans
      .filter((plan) => plan.state !== 'settled')
      .map((plan) => new Error(`AI mock expectation ${plan.id ?? 'tool'} is ${plan.state}`));

    if (failures.length || unfinished.length)
      throw new AggregateError([...failures, ...unfinished], 'AI mock verification failed');
  }

  return {
    next<T extends Target>(
      target: T,
      options: {
        readonly input: NoInfer<T['input']['Type']>;
        readonly output: NoInfer<T['output']['Type']>;
        readonly hold?: boolean;
      }
    ) {
      const outputCodec = codec(target.output);
      const output = outputCodec.encode(options.output);

      return register(
        target,
        options.input,
        () => ({ value: outputCodec.decode(output), json: output }),
        options.hold
      );
    },
    failNext<T extends Target>(
      target: T,
      options: {
        readonly input: NoInfer<T['input']['Type']>;
        readonly error: Error;
        readonly hold?: boolean;
      }
    ) {
      if (!(options.error instanceof Error))
        throw new TypeError('AI mock failures require an Error');

      return register(
        target,
        options.input,
        () => {
          throw options.error;
        },
        options.hold
      );
    },
    runtime: {
      model: (_tier: unknown, call: Invocation) =>
        Effect.try({ try: () => model(call), catch: (error) => error }),
      executeTool: (call: Invocation, _actual: () => Effect.Effect<unknown, unknown>) =>
        Effect.tryPromise({
          try: (signal) => consume(call, signal).then((result) => result.value),
          catch: (error) => error
        })
    },
    verify,
    [Symbol.dispose]: verify
  };
}
