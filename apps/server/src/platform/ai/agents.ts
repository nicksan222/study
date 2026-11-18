/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Implements Effect-facing agent generation and streaming over native Effect models. It     │
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

import { agentRunIdSchema } from '@study/contracts';
import type {
  agentObservationSchema,
  agentUpdateSchema,
  procedurePurposeSchema
} from '@study/contracts';
import type { ErrorKind } from '@study/contracts';
import { StudyError, isRetryable } from '@study/contracts';
import type { ModelTier } from '@study/contracts';
import type { AgentRules } from '@study/contracts';
import type { UsageRecord } from '@study/contracts';
import type { Cause } from 'effect';
import {
  Cause as EffectCause,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Result,
  Schema,
  Stream
} from 'effect';
import type { Tool, Toolkit } from 'effect/ai';
import { AiError, LanguageModel, Model, Prompt, Response } from 'effect/ai';
import { Activity } from 'effect/workflow';

import { makeAdmission } from '#server/platform/ai/admission';
import type { Admission } from '#server/platform/ai/admission';
import type {
  ContextOptions,
  ContextPreparation,
  ContextAgentResult,
  ContextServices
} from '#server/platform/ai/context-preparation/agent';
import { AiRequestCheck } from '#server/platform/ai/model';
import type { AiModel } from '#server/platform/ai/model';
import { AiPhase } from '#server/platform/ai/phase';
import { batchAgentProgress } from '#server/platform/ai/progress';
import type { ModelRelease } from '#server/platform/ai/providers/release';
import { adaptProviderTool } from '#server/platform/ai/providers/tools';
import { makeAgentToolkit } from '#server/platform/ai/tool-adapter';
import {
  agentNestingLimit,
  AgentCallSequence,
  ProcedureTraceScope,
  traceDetail
} from '#server/platform/ai/trace';
import { normalizeUsage } from '#server/platform/ai/usage';
import type {
  AgentDefinition,
  AgentEnvironment,
  AiInvocation
} from '#server/platform/definitions/define-agent';
import { recordAiRetry } from '#server/platform/observability/index';

export interface AgentsConfig extends AgentEnvironment {
  rules: Effect.Effect<AgentRules, StudyError>;
  model: (tier: ModelTier, call: AiInvocation) => Effect.Effect<AiModel, StudyError>;
  recordUsage?: (usage: UsageRecord) => Effect.Effect<void>;
  observeModelRelease?: (release: ModelRelease) => Effect.Effect<void>;
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

/** The provider finished successfully, but its output cannot complete the requested task. */
export class AgentOutputError extends StudyError {
  constructor(message: string) {
    super('transient', message);
  }
}

function failure(error: unknown): StudyError {
  if (error instanceof StudyError) return error;

  if (AiError.isAiErrorReason(error))
    return failure(AiError.make({ module: 'Agents', method: 'generate', reason: error }));

  if (AiError.isAiError(error)) {
    if (error.cause instanceof StudyError) return error.cause;

    const status = 'http' in error.reason ? error.reason.http?.response?.status : undefined;
    const httpKind = status === undefined ? undefined : providerHttpFailure(status);
    const kinds: Readonly<Record<string, ErrorKind>> = {
      AuthenticationError: 'auth',
      RateLimitError: 'rate_limited',
      QuotaExhaustedError: 'config',
      ContentPolicyError: 'invalid_input',
      InvalidRequestError: 'invalid_input',
      UnsupportedSchemaError: 'unsupported',
      ToolParameterValidationError: 'invalid_input',
      ToolNotFoundError: 'invalid_input',
      ToolConfigurationError: 'config',
      InvalidToolResultError: 'internal',
      ToolResultEncodingError: 'internal'
    };

    return new StudyError(
      httpKind ?? kinds[error.reason._tag] ?? 'transient',
      'Model request failed'
    );
  }

  return new StudyError('transient', 'Agent request failed', { cause: error });
}

function providerHttpFailure(status: number): ErrorKind {
  const kinds: Readonly<Record<number, ErrorKind>> = {
    400: 'invalid_input',
    401: 'auth',
    402: 'config',
    403: 'auth',
    404: 'model_unavailable',
    405: 'unsupported',
    422: 'invalid_input',
    429: 'rate_limited'
  };

  return (
    kinds[status] ?? (status >= 500 || status === 408 || status === 409 ? 'transient' : 'config')
  );
}

/** Context definitions require captured sources and keep their reference type in returned evidence. */
export function generateAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>,
  Requirements = never,
  Ref = never,
  R = never,
  PreparationRequirements = never
>(
  definition: Omit<AgentDefinition<I, O, Requirements>, 'context'> & {
    context: ContextPreparation<PreparationRequirements>;
  },
  input: I['Type'],
  options: AgentOptions & ContextOptions<Ref, R>
): Effect.Effect<
  ContextAgentResult<O['Type'], Ref>,
  StudyError,
  Agents | Requirements | PreparationRequirements | R | ContextServices
>;

export function generateAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>,
  Requirements = never
>(
  definition: AgentDefinition<I, O, Requirements> & { context?: undefined },
  input: I['Type'],
  options?: AgentOptions
): Effect.Effect<O['Type'], StudyError, Agents | Requirements>;

export function generateAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>,
  Requirements,
  Ref,
  R
>(
  definition: AgentDefinition<I, O, Requirements>,
  input: I['Type'],
  options: AgentOptions & Partial<ContextOptions<Ref, R>> = {}
) {
  if (!definition.context) return generatePlainAgent(definition, input, options);

  if (!options.sources || !options.scope || !options.preflight)
    return Effect.fail(
      new StudyError(
        'invalid_input',
        'Context agents require captured sources, preflight and a stable scope'
      )
    );

  const { context, ...plain } = definition;
  const contextOptions = {
    sources: options.sources,
    scope: options.scope,
    preflight: options.preflight
  };

  return Effect.gen(function* () {
    yield* agentLimits(options);
    const validated = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Schema.toType(definition.input))(input),
      catch: (cause) => new StudyError('invalid_input', 'Invalid agent input', { cause })
    });
    const originalPrompt = yield* Effect.try({
      try: () => definition.prompt(validated),
      catch: (cause) => new StudyError('invalid_input', 'Invalid agent prompt', { cause })
    });
    const prepared = yield* context.prepare(originalPrompt, contextOptions);
    const services = yield* Effect.context<R>();
    const preflight = contextOptions.preflight.pipe(
      Effect.provideContext(services),
      Effect.asVoid,
      Effect.mapError((error) =>
        error instanceof StudyError
          ? error
          : new StudyError(error.kind, error.message, {
              retryAfterMs: error.retryAfterMs,
              ...(error.resource ? { resource: error.resource } : {})
            })
      )
    );

    yield* preflight;
    const agents = yield* Agents;
    const output = yield* generatePlainAgent({ ...plain, prompt: () => prepared.prompt }, input, {
      ...options,
      preflight
    }).pipe(
      Effect.provideService(Agents, {
        ...agents,
        searchSources: (query) =>
          preflight.pipe(Effect.andThen(Effect.sync(() => prepared.search(query))))
      })
    );

    yield* preflight;

    return { output, evidence: prepared.evidence, coverage: prepared.coverage };
  });
}

/** Consume the agent stream and return only its schema-validated completion value. */
function generatePlainAgent<
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
  if (definition.context)
    return Stream.fail(new StudyError('unsupported', 'Context agents require durable generation'));

  /** Capture one run identity and preserve its scoped ownership through all observations. */
  function* runAgentStream(queue: Queue.Queue<AgentProgress<O['Type']>, StudyError | Cause.Done>) {
    const service = yield* Agents;
    const { steps, retries } = yield* agentLimits(options);
    const parentScope = yield* ProcedureTraceScope;

    if (parentScope.depth >= agentNestingLimit)
      return yield* Effect.fail(new StudyError('invalid_input', 'Agent nesting limit exceeded'));

    const validated = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Schema.toType(definition.input))(input),
      catch: () => new StudyError('invalid_input', 'Invalid agent input')
    });
    const outputSchema =
      definition.mode === 'object' ? Schema.toCodecJson(definition.output) : definition.output;
    const model = yield* service.model(definition.model, { definition, input: validated });
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
    const hasFunctionTools = Object.values(definition.tools ?? {}).some(
      (tool) => !('provider' in tool)
    );
    const availableTools = Object.entries(definition.tools ?? {}).filter(
      ([, tool]) =>
        !('provider' in tool) || adaptProviderTool(model, tool, hasFunctionTools) !== undefined
    );
    const wiki = availableTools.map(
      ([name, tool]) =>
        `${name} (${tool.mutates ? 'changes local data' : 'read only'}): ${tool.description}\nWhen: ${tool.wiki.when}\nExamples: ${tool.wiki.examples.join(' | ')}\nLimits: ${tool.wiki.limits}`
    );
    const system = wiki.length
      ? `${baseSystem}\n\nAvailable capabilities (use this guide when explaining what you can do):\n${wiki.join('\n\n')}`
      : baseSystem;
    const { run, childScope } = yield* agentRunTrace(
      definition,
      validated,
      service.now ?? Date.now
    );
    const progress = batchAgentProgress(
      (event) => service.observe?.({ ...run, event }) ?? Effect.void
    );
    const { observe } = progress;
    let published = false;
    const emit = (event: typeof agentUpdateSchema.Type) =>
      Effect.gen(function* () {
        yield* observe(event);
        yield* Queue.offer(queue, event);
        published = true;
      });

    yield* observe({ type: 'start' });

    function* execute() {
      const toolkit = yield* makeAgentToolkit(
        availableTools.flatMap(([name, tool]) =>
          'provider' in tool ? [] : [[name, tool] as const]
        ),
        service,
        emit,
        availableTools.flatMap(([, tool]) =>
          'provider' in tool ? [adaptProviderTool(model, tool, hasFunctionTools)!] : []
        )
      );
      const structured = yield* Effect.try({
        try: () =>
          definition.mode === 'object'
            ? model.withOutputSchema?.(Schema.toCodecJson(definition.output))
            : undefined,
        catch: failure
      });
      const selected = structured?.model ?? model;
      const decodeOutput = structured?.codec ?? outputSchema;
      const finishOutput = Effect.fn(function* (
        text: string,
        finish: Response.FinishReason | undefined
      ) {
        if (finish !== 'stop')
          return yield* Effect.fail(new StudyError('transient', 'Agent response did not complete'));

        if (!text.trim()) return yield* Effect.fail(new AgentOutputError('Agent output was empty'));

        const output = yield* Effect.try({
          try: () => {
            const value =
              definition.mode === 'object'
                ? Schema.decodeUnknownSync(decodeOutput)(JSON.parse(text))
                : text;

            return Schema.decodeUnknownSync(Schema.toType(definition.output))(value);
          },
          catch: () => new AgentOutputError('Agent output did not match its schema')
        });

        if (model.release && service.observeModelRelease)
          yield* service.observeModelRelease(model.release);

        yield* observe({ type: 'complete', output: traceDetail(output) });
        yield* Queue.offer(queue, { type: 'complete', output });
        yield* Queue.end(queue);

        return;
      });
      const attempt = Effect.gen(function* () {
        let prompt = yield* Effect.try({
          try: () =>
            Prompt.concat(
              Prompt.make([{ role: 'system', content: system }]),
              definition.prompt(validated)
            ),
          catch: failure
        });
        let text = '';

        for (let step = 0; step < steps; step++) {
          const {
            parts,
            finish,
            text: roundText
          } = yield* modelRound(
            service,
            { runId: run.runId, agent: definition.id },
            prompt,
            toolkit,
            emit,
            options.preflight ?? Effect.void
          );

          text += roundText;

          if (finish !== 'stop' && finish !== 'tool-calls')
            return yield* Effect.fail(
              new StudyError('transient', 'Agent response did not complete')
            );

          const calls = parts.filter(
            (part): part is Response.ToolCallPart<string, unknown> =>
              part.type === 'tool-call' && !part.providerExecuted
          );

          if (calls.length === 0) return yield* finishOutput(text, finish);

          if (step + 1 === steps)
            return yield* Effect.fail(new StudyError('transient', 'Agent step limit reached'));

          // Provider capacity ends before tools run, so children use the same ordinary gate.
          for (const call of calls) {
            const results = yield* toolkit.handle(call.name, call.params, call.id);

            yield* Stream.runForEach(results, (result) =>
              Effect.sync(() => {
                parts.push(
                  Response.toolResultPart({
                    ...result,
                    id: call.id,
                    name: call.name,
                    providerExecuted: false
                  })
                );
              })
            );
          }

          prompt = Prompt.concat(prompt, Prompt.fromResponseParts(parts));

          if (definition.mode === 'object') text = '';
        }
      }).pipe(
        Effect.provide(selected),
        Effect.provideService(AiRequestCheck, options.preflight ?? Effect.void),
        Effect.catchCause((cause) => {
          const defect = EffectCause.findDefect(cause);

          return Result.isSuccess(defect) && defect.success instanceof StudyError
            ? Effect.fail(defect.success)
            : Effect.failCause(cause);
        }),
        Effect.mapError(failure)
      );
      let retryCount = 0;

      yield* attempt.pipe(
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
    }

    const execution = Effect.gen(execute).pipe(
      Effect.provideService(ProcedureTraceScope, childScope),
      Effect.provideService(AgentCallSequence, { next: 0 })
    );

    return yield* execution.pipe(
      Effect.raceFirst(
        Effect.forever(Effect.sleep('100 millis').pipe(Effect.andThen(progress.flush)))
      ),
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && !EffectCause.hasInterruptsOnly(exit.cause)
          ? observe({ type: 'failed', kind: failure(EffectCause.squash(exit.cause)).kind }).pipe(
              Effect.ignore
            )
          : Effect.void
      )
    );
  }

  return Stream.callback<AgentProgress<O['Type']>, StudyError, Agents | Requirements>(
    (queue) =>
      Effect.gen(() => runAgentStream(queue)).pipe(
        // Self-interruption must close the callback queue from an uninterruptible finalizer.
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Queue.failCause(queue, exit.cause) : Effect.void
        ),
        Effect.scoped,
        Effect.mapError(failure),
        Effect.withSpan(`agent.${definition.id}.stream`)
      ),
    { bufferSize: 16, strategy: 'suspend' }
  );
}

/** One admitted provider round, including accounting before terminal validation. */
function modelRound(
  service: AgentsConfig & { admission: Admission },
  invocation: Pick<UsageRecord, 'runId' | 'agent'>,
  prompt: Prompt.Prompt,
  toolkit: Toolkit.WithHandler<Record<string, Tool.Any>>,
  emit: (event: typeof agentUpdateSchema.Type) => Effect.Effect<void, StudyError>,
  preflight: Effect.Effect<void, StudyError>
) {
  return Effect.gen(function* () {
    const parts: Response.AnyPart[] = [];
    let finish: Response.FinishReason | undefined;
    let text = '';
    const id = crypto.randomUUID();
    const provider = yield* Model.ProviderName;
    const model = yield* Model.ModelName;
    let accounted = false;

    yield* service.admission.run(
      preflight.pipe(
        Effect.andThen(
          LanguageModel.streamText({ prompt, toolkit, disableToolCallResolution: true }).pipe(
            Stream.runForEach((part) =>
              Effect.gen(function* () {
                parts.push(part);

                if (part.type === 'error') return yield* Effect.fail(failure(part.error));

                if (part.type === 'text-delta') {
                  text += part.delta;
                  yield* emit({ type: 'text-delta', text: part.delta });
                }

                if (part.type === 'finish') {
                  finish = part.reason;

                  if (!accounted && service.recordUsage) {
                    accounted = true;
                    yield* service.recordUsage({
                      ...normalizeUsage(part.usage),
                      id,
                      ...invocation,
                      provider,
                      model,
                      timestamp: (service.now ?? Date.now)()
                    });
                  }
                }
              })
            )
          )
        )
      )
    );

    return { parts, finish, text };
  });
}

/** Allocate a stable callback path for each agent call within its parent procedure attempt. */
function agentRunTrace(
  definition: {
    id: string;
    purpose?: typeof procedurePurposeSchema.Type;
    recordInput?: boolean;
    mode?: 'text' | 'object';
  },
  input: unknown,
  now: () => number
) {
  return Effect.gen(function* () {
    const scope = yield* ProcedureTraceScope;
    const sequence = yield* AgentCallSequence;
    const ordinal = sequence ? sequence.next++ : crypto.randomUUID();
    const run = {
      runId: agentRunIdSchema.make(crypto.randomUUID()),
      agentId: definition.id,
      phase: yield* AiPhase,
      mode: definition.mode ?? ('text' as const),
      trace: {
        kind: 'agent' as const,
        purpose: definition.purpose ?? 'agent',
        parentRunId: scope.parentRunId,
        ...(scope.parentToolCallId ? { parentToolCallId: scope.parentToolCallId } : {}),
        attempt: yield* Activity.CurrentAttempt,
        startedAtMs: BigInt(now()),
        ...(definition.recordInput === false ? {} : { input: traceDetail(input) })
      }
    };

    return {
      run,
      childScope: {
        parentRunId: run.runId,
        depth: scope.depth + 1,
        path: `${scope.path}/${definition.id}-${ordinal}`
      }
    };
  });
}
