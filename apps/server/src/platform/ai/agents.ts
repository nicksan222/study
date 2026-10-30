import type { LanguageModelV3 } from '@ai-sdk/provider';
import { StudyError, isRetryable } from '@study/contracts/errors';
import { streamText, Output, stepCountIs } from 'ai';
import { Context, Effect, Layer, Option, Queue, References, Schema, Stream } from 'effect';

import { makeAdmission } from '#server/platform/ai/admission';
import type { Admission } from '#server/platform/ai/admission';
import { ChatGptRequestError, withRequestCheck } from '#server/platform/ai/providers/chatgpt/model';
import { standardSchema } from '#server/platform/ai/schema';
import { adaptTool, adaptRequestCheck } from '#server/platform/ai/tool-adapter';
import type {
  AgentDefinition,
  AgentEnvironment,
  ModelTier
} from '#server/platform/definitions/define-agent';
import { recordAiRetry } from '#server/platform/observability/index';

export interface AgentsConfig extends AgentEnvironment {
  model: (tier: ModelTier) => Effect.Effect<LanguageModelV3, StudyError>;
}

export class Agents extends Context.Service<Agents, AgentsConfig & { admission: Admission }>()(
  'study/Agents'
) {}

export const layer = (config: AgentsConfig) =>
  Layer.succeed(Agents, { ...config, admission: makeAdmission() });

export interface AgentOptions {
  maxSteps?: number;
  maxRetries?: number;
  preflight?: Effect.Effect<void, StudyError>;
}

export type AgentProgress<A> =
  | { type: 'text-delta'; text: string }
  | { type: 'complete'; output: A };

function failure(error: unknown): StudyError {
  if (error instanceof StudyError) return error;

  if (error instanceof ChatGptRequestError)
    return new StudyError(error.kind, 'Model request failed', { cause: error });

  return new StudyError('transient', 'Agent request failed', { cause: error });
}

export function generateAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>
>(
  definition: AgentDefinition<I, O>,
  input: I['Type'],
  options: AgentOptions = {}
): Effect.Effect<O['Type'], StudyError, Agents> {
  return Stream.runLast(streamAgent(definition, input, options)).pipe(
    Effect.flatMap((event) => {
      const last = Option.getOrUndefined(event);

      return last?.type === 'complete'
        ? Effect.succeed(last.output)
        : Effect.fail(new StudyError('internal', 'Agent output missing'));
    }),
    Effect.withSpan(`agent.${definition.id}`)
  );
}

export function streamAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>
>(
  definition: AgentDefinition<I, O>,
  input: I['Type'],
  options: AgentOptions = {}
): Stream.Stream<AgentProgress<O['Type']>, StudyError, Agents> {
  return Stream.callback<AgentProgress<O['Type']>, StudyError, Agents>(
    (queue) =>
      Effect.gen(function* () {
        const service = yield* Agents;
        const steps = options.maxSteps ?? 5;
        const retries = options.maxRetries ?? 0;

        if (
          !Number.isInteger(steps) ||
          steps < 1 ||
          steps > 20 ||
          !Number.isInteger(retries) ||
          retries < 0 ||
          retries > 5
        )
          return yield* Effect.fail(new StudyError('invalid_input', 'Invalid agent limits'));

        const validated = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(definition.input)(input),
          catch: () => new StudyError('invalid_input', 'Invalid agent input')
        });
        const model = yield* service.model(definition.model);
        const language =
          typeof service.language === 'string' ? service.language : yield* service.language;
        const span = yield* Effect.currentSpan;
        const annotations = yield* References.CurrentLogAnnotations;
        const callbackContext = yield* Effect.context<never>();

        return yield* service.admission.run(
          Effect.gen(function* () {
            if (options.preflight) yield* options.preflight;

            const checkedModel = options.preflight
              ? yield* Effect.try({
                  try: () =>
                    withRequestCheck(
                      model,
                      adaptRequestCheck(options.preflight!, span, annotations, callbackContext)
                    ),
                  catch: failure
                })
              : model;
            let retryCount = 0;
            let published = false;

            const attempt = Effect.gen(function* () {
              const controller = yield* Effect.acquireRelease(
                Effect.sync(() => new AbortController()),
                (controller) => Effect.sync(() => controller.abort())
              );
              const result = yield* Effect.try({
                try: () => {
                  const prompt = definition.prompt(validated);
                  const tools = Object.fromEntries(
                    Object.entries(definition.tools ?? {}).map(([name, value]) => [
                      name,
                      adaptTool(value, service, span, annotations, callbackContext)
                    ])
                  );

                  return streamText({
                    onError: () => {},
                    model: checkedModel,
                    system:
                      typeof definition.instructions === 'function'
                        ? definition.instructions(language)
                        : definition.instructions,
                    ...(typeof prompt === 'string' ? { prompt } : { messages: prompt }),
                    tools,
                    stopWhen: stepCountIs(steps),
                    maxRetries: 0,
                    abortSignal: controller.signal,
                    ...(definition.mode === 'object'
                      ? { output: Output.object({ schema: standardSchema(definition.output) }) }
                      : {})
                  });
                },
                catch: failure
              });
              const iterator = result.fullStream[Symbol.asyncIterator]();
              let text = '';
              let finished = false;

              while (true) {
                const next = yield* Effect.tryPromise({
                  try: () => iterator.next(),
                  catch: failure
                });

                if (next.done) break;

                const part = next.value;

                if (
                  part.type === 'error' ||
                  part.type === 'tool-error' ||
                  part.type === 'tool-output-denied' ||
                  part.type === 'abort'
                )
                  return yield* Effect.fail(
                    failure(
                      'error' in part
                        ? part.error
                        : new StudyError('transient', 'Agent stream failed', { cause: part })
                    )
                  );

                if (part.type === 'text-delta') {
                  text += part.text;
                  yield* Queue.offer(queue, { type: 'text-delta', text: part.text });
                  published = true;
                }

                if (part.type === 'finish') {
                  if (part.finishReason !== 'stop')
                    return yield* Effect.fail(
                      new StudyError('transient', 'Agent response did not complete')
                    );

                  finished = true;
                }
              }

              if (!finished)
                return yield* Effect.fail(
                  new StudyError('transient', 'Agent response did not complete')
                );

              if (!text.trim())
                return yield* Effect.fail(new StudyError('transient', 'Agent output was empty'));

              const raw =
                definition.mode === 'object'
                  ? yield* Effect.tryPromise({ try: () => result.output, catch: failure })
                  : text;
              const output = yield* Effect.try({
                try: () => Schema.decodeUnknownSync(definition.output)(raw),
                catch: failure
              });

              yield* Queue.offer(queue, { type: 'complete', output });
              yield* Queue.end(queue);
            }).pipe(Effect.scoped);

            return yield* attempt.pipe(
              Effect.retry({
                times: 5,
                while: (error) => {
                  if (published || retryCount >= retries || !isRetryable(error.kind))
                    return Effect.succeed(false);

                  retryCount++;

                  return recordAiRetry().pipe(Effect.as(true));
                }
              })
            );
          })
        );
      }).pipe(
        Effect.mapError((error) => (error instanceof StudyError ? error : failure(error))),
        Effect.withSpan(`agent.${definition.id}.stream`)
      ),
    { bufferSize: 16, strategy: 'suspend' }
  );
}
