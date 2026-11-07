/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Implements Effect-facing agent generation and streaming over AI SDK models. It     │
 * │ validates inputs and outputs, adapts tools and request checks, applies admission limits, │
 * │ and records retry behavior.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports AgentsConfig, Agents, layer, AgentOptions, AgentProgress, generateAgent,       │
 * │   streamAgent. Generation decodes input and output schemas; streaming emits text deltas  │
 * │   and a validated completion event.                                                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature agents supply AgentDefinition values; the Agents layer injects model selection,  │
 * │ language, source search, and admission dependencies.                                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { agentRunIdSchema } from '@study/contracts/ai/progress';
import type { agentObservationSchema, agentUpdateSchema } from '@study/contracts/ai/progress';
import { StudyError, isRetryable } from '@study/contracts/errors';
import type { ModelTier } from '@study/contracts/settings/schemas';
import type { AgentRules } from '@study/contracts/settings/types';
import type { UsageRecord } from '@study/contracts/settings/usage';
import { streamText, Output, stepCountIs } from 'ai';
import type { Cause } from 'effect';
import {
  Cause as EffectCause,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  References,
  Schema,
  Stream
} from 'effect';

import { makeAdmission } from '#server/platform/ai/admission';
import type { Admission } from '#server/platform/ai/admission';
import { batchAgentProgress } from '#server/platform/ai/progress';
import { ChatGptRequestError, withRequestCheck } from '#server/platform/ai/providers/chatgpt/model';
import { adaptProviderTool } from '#server/platform/ai/providers/chatgpt/tools';
import { standardSchema } from '#server/platform/ai/schema';
import { adaptTool, adaptRequestCheck, adaptUsageRecorder } from '#server/platform/ai/tool-adapter';
import { withUsageTracking } from '#server/platform/ai/usage';
import type { AgentDefinition, AgentEnvironment } from '#server/platform/definitions/define-agent';
import { recordAiRetry } from '#server/platform/observability/index';

export interface AgentsConfig extends AgentEnvironment {
  rules: Effect.Effect<AgentRules, StudyError>;
  model: (tier: ModelTier) => Effect.Effect<LanguageModelV3, StudyError>;
  recordUsage?: (usage: UsageRecord) => Effect.Effect<void>;
  now?: () => number;
  observe?: (observation: typeof agentObservationSchema.Type) => Effect.Effect<void, StudyError>;
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

/** Reject invalid step and retry limits before admitting any provider work. */
function agentLimits(options: AgentOptions) {
  const steps = options.maxSteps ?? 5;
  const retries = options.maxRetries ?? 0;

  return Number.isInteger(steps) &&
    steps >= 1 &&
    steps <= 20 &&
    Number.isInteger(retries) &&
    retries >= 0 &&
    retries <= 5
    ? Effect.succeed({ steps, retries })
    : Effect.fail(new StudyError('invalid_input', 'Invalid agent limits'));
}

export type AgentProgress<A> = typeof agentUpdateSchema.Type | { type: 'complete'; output: A };

function failure(error: unknown): StudyError {
  if (error instanceof StudyError) return error;

  if (error instanceof ChatGptRequestError)
    return new StudyError(error.kind, 'Model request failed', { cause: error });

  return new StudyError('transient', 'Agent request failed', { cause: error });
}

/** Consume the agent stream and return only its schema-validated completion value. */
export function generateAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>,
  Requirements = never
>(
  definition: AgentDefinition<I, O, Requirements>,
  input: I['Type'],
  options: AgentOptions = {}
): Effect.Effect<O['Type'], StudyError, Agents | Requirements> {
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

/**
 * Stream every text delta and tool update while batching durable observations separately.
 * The stream scope owns provider cancellation and the preview-flush fiber; retries stop
 * after a visible update, and completion is emitted only after output validation.
 */
export function streamAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>,
  Requirements = never
>(
  definition: AgentDefinition<I, O, Requirements>,
  input: I['Type'],
  options: AgentOptions = {}
): Stream.Stream<AgentProgress<O['Type']>, StudyError, Agents | Requirements> {
  /** Capture one run identity and preserve its scoped ownership through all observations. */
  function* runAgentStream(queue: Queue.Queue<AgentProgress<O['Type']>, StudyError | Cause.Done>) {
    const service = yield* Agents;
    const { steps, retries } = yield* agentLimits(options);

    const validated = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(definition.input)(input),
      catch: () => new StudyError('invalid_input', 'Invalid agent input')
    });
    const model = yield* service.model(definition.model);
    const language =
      typeof service.language === 'string' ? service.language : yield* service.language;
    const rules = yield* service.rules;
    const instructions =
      typeof definition.instructions === 'function'
        ? definition.instructions(language)
        : definition.instructions;
    const customRules = [...new Set(definition.customRules)]
      .map((rule) => rules[rule.key].trim())
      .filter(Boolean);
    const baseSystem = customRules.length
      ? `${instructions}\n\nUser preferences (apply where compatible with the task, required output format and source fidelity):\n${customRules.join('\n\n')}`
      : instructions;
    const wiki = Object.entries(definition.tools ?? {}).map(
      ([name, tool]) =>
        `${name} (${tool.mutates ? 'changes local data' : 'read only'}): ${tool.description}\nWhen: ${tool.wiki.when}\nExamples: ${tool.wiki.examples.join(' | ')}\nLimits: ${tool.wiki.limits}`
    );
    const system = wiki.length
      ? `${baseSystem}\n\nAvailable capabilities (use this guide when explaining what you can do):\n${wiki.join('\n\n')}`
      : baseSystem;
    const span = yield* Effect.currentSpan;
    const annotations = yield* References.CurrentLogAnnotations;
    const callbackContext = yield* Effect.context<Requirements>();
    const run = {
      runId: agentRunIdSchema.make(randomUUID()),
      agentId: definition.id,
      mode: definition.mode ?? ('text' as const)
    };
    const progress = batchAgentProgress(
      (event) => service.observe?.({ ...run, event }) ?? Effect.void
    );
    const { observe } = progress;

    yield* observe({ type: 'start' });

    return yield* service.admission
      .run(
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
          /** Observe before delivery and prevent retry once an update reaches the consumer. */
          const emit = (event: typeof agentUpdateSchema.Type) =>
            Effect.gen(function* () {
              yield* observe(event);
              yield* Queue.offer(queue, event);
              published = true;
            });

          /** Own one cancellable provider attempt through validated terminal publication. */
          function* runAttempt() {
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
                    'provider' in value
                      ? adaptProviderTool(value)
                      : adaptTool(value, service, span, annotations, callbackContext, {
                          name,
                          emit
                        })
                  ])
                );

                return streamText({
                  onError: () => {},
                  model: service.recordUsage
                    ? withUsageTracking(
                        checkedModel,
                        { runId: run.runId, agent: definition.id },
                        adaptUsageRecorder(service.recordUsage, span, annotations),
                        service.now ?? Date.now
                      )
                    : checkedModel,
                  system,
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
            const text = yield* Effect.gen(readStream);

            /** Forward deltas but reject provider errors, truncation and empty responses. */
            function* readStream() {
              let text = '';
              let finished = false;

              while (true) {
                const next = yield* Effect.tryPromise({
                  try: () => iterator.next(),
                  catch: failure
                });

                if (next.done) break;

                const part = next.value;

                if (['error', 'tool-error', 'tool-output-denied', 'abort'].includes(part.type))
                  return yield* Effect.fail(agentStreamError(part));

                if (part.type === 'text-delta') {
                  text += part.text;
                  yield* emit({ type: 'text-delta', text: part.text });
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

              return text;
            }

            const raw =
              definition.mode === 'object'
                ? yield* Effect.tryPromise({ try: () => result.output, catch: failure })
                : text;
            const output = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(definition.output)(raw),
              catch: failure
            });

            yield* observe({ type: 'complete' });
            yield* Queue.offer(queue, { type: 'complete', output });
            yield* Queue.end(queue);
          }

          const attempt = Effect.gen(runAttempt).pipe(Effect.scoped);

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
      )
      .pipe(
        Effect.raceFirst(
          Effect.forever(Effect.sleep('100 millis').pipe(Effect.andThen(progress.flush)))
        ),
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? observe({
                type: 'failed',
                kind: EffectCause.hasInterruptsOnly(exit.cause)
                  ? 'cancelled'
                  : failure(EffectCause.squash(exit.cause)).kind
              }).pipe(Effect.ignore)
            : Effect.void
        )
      );
  }

  return Stream.callback<AgentProgress<O['Type']>, StudyError, Agents | Requirements>(
    (queue) =>
      Effect.gen(() => runAgentStream(queue)).pipe(
        Effect.mapError(failure),
        Effect.withSpan(`agent.${definition.id}.stream`)
      ),
    { bufferSize: 16, strategy: 'suspend' }
  );
}

function agentStreamError(part: { readonly type: string; readonly error?: unknown }) {
  return failure(
    'error' in part
      ? part.error
      : new StudyError('transient', 'Agent stream failed', { cause: part })
  );
}
