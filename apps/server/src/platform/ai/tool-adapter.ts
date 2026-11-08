/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Bridges feature-owned Effect agent tools and request checks into AI SDK callbacks. │
 * │ It carries scoped logging, tracing, cancellation, and the agent environment across that  │
 * │ boundary.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports adaptTool and adaptRequestCheck. Tool execution restores the captured Effect   │
 * │   context and parent span, while the request check forwards cancellation to its signal.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ agents.ts creates these provider callbacks from feature-owned tools and scoped Effects;  │
 * │ this module does not define tool policy.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { agentUpdateSchema } from '@study/contracts/ai/progress';
import { StudyError } from '@study/contracts/errors';
import type { UsageRecord } from '@study/contracts/settings/usage';
import { dynamicTool } from 'ai';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import type { Context, Tracer } from 'effect';

import { standardSchema } from '#server/platform/ai/schema';
import type { AgentEnvironment, AgentTool } from '#server/platform/definitions/define-agent';
import { safeMetadata } from '#server/platform/observability/index';

/**
 * Restore the captured Effect context for provider-invoked tools and forward cancellation.
 * When progress is enabled, publish tool identity and outcome around the actual execution.
 */
export function adaptTool<Requirements>(
  definition: AgentTool<Schema.ConstraintDecoder<unknown>, unknown, Requirements>,
  environment: AgentEnvironment,
  span: Tracer.Span,
  annotations: Readonly<Record<string, unknown>>,
  context: Context.Context<Requirements>,
  progress?: {
    name: string;
    emit: (event: typeof agentUpdateSchema.Type) => Effect.Effect<void, StudyError>;
  }
) {
  let ordinal = 0;

  return dynamicTool({
    description: definition.description,
    inputSchema: standardSchema(Schema.toEncoded(Schema.toCodecJson(definition.input))),
    execute: (input, options) => {
      const callOrdinal = ++ordinal;
      const toolEnvironment: AgentEnvironment = {
        ...environment,
        searchSources: (query, signal) =>
          environment.searchSources(query, signal ?? options.abortSignal)
      };

      const identity = { toolCallId: options.toolCallId, toolName: progress?.name ?? '' };

      return Effect.runPromiseWith(context)(
        Effect.gen(function* () {
          if (progress)
            yield* progress.emit({ type: 'tool-start', ...identity, input: toolDetail(input) });

          const decoded = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(definition.input))(
            input
          ).pipe(
            Effect.mapError(
              (cause) => new StudyError('invalid_input', 'Invalid tool input', { cause })
            )
          );

          const execute = definition.execute(decoded, toolEnvironment).pipe(
            Effect.flatMap(Schema.encodeUnknownEffect(Schema.toCodecJson(definition.output))),
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
            Effect.mapError((cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('internal', 'Invalid tool result', { cause })
            ),
            Effect.provideContext(context)
          );
          const jsonInput = yield* Schema.decodeUnknownEffect(Schema.Json)(input).pipe(
            Effect.mapError(
              (cause) => new StudyError('invalid_input', 'Invalid JSON tool input', { cause })
            )
          );
          const result = environment.runTool
            ? environment.runTool(
                {
                  name: progress?.name ?? '',
                  ordinal: callOrdinal,
                  input: jsonInput,
                  mutates: definition.mutates
                },
                execute
              )
            : execute;

          return yield* result.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(definition.output))),
            Effect.flatMap(Schema.encodeUnknownEffect(Schema.toCodecJson(definition.output))),
            Effect.mapError((error) =>
              error instanceof StudyError
                ? error
                : new StudyError('internal', 'Invalid tool result', { cause: error })
            )
          );
        }).pipe(
          Effect.onExit((exit) =>
            progress && Exit.isFailure(exit)
              ? progress
                  .emit({
                    type: 'tool-finish',
                    ...identity,
                    outcome: toolFailureKind(exit.cause) === 'cancelled' ? 'cancelled' : 'failure',
                    errorKind: toolFailureKind(exit.cause)
                  })
                  .pipe(Effect.ignore)
              : Effect.void
          ),
          Effect.tap((output) =>
            progress
              ? progress.emit({
                  type: 'tool-finish',
                  ...identity,
                  outcome: 'success',
                  output: toolDetail(output)
                })
              : Effect.void
          ),
          Effect.annotateLogs(safeMetadata(annotations)),
          Effect.withParentSpan(span),
          Effect.withSpan('agent.tool')
        ),
        { signal: options.abortSignal }
      );
    }
  });
}

/** Bridge a scoped request check to the provider's last cancellable HTTP boundary. */
export function adaptRequestCheck<Requirements>(
  check: Effect.Effect<void, StudyError>,
  span: Tracer.Span,
  annotations: Readonly<Record<string, unknown>>,
  context: Context.Context<Requirements>
) {
  return (signal: AbortSignal | undefined) =>
    Effect.runPromiseWith(context)(
      check.pipe(Effect.annotateLogs(safeMetadata(annotations)), Effect.withParentSpan(span)),
      { signal }
    );
}

/** Presentation previews are bounded; the canonical tool result remains schema validated. */
function toolDetail(value: unknown) {
  const text = JSON.stringify(value, null, 2) ?? '';

  return { text: text.slice(0, 12000), truncated: text.length > 12000 };
}

function toolFailureKind(cause: Cause.Cause<StudyError>) {
  if (Cause.hasInterruptsOnly(cause)) return 'cancelled' as const;

  const failure = Cause.findErrorOption(cause);

  return Option.isSome(failure) ? failure.value.kind : ('internal' as const);
}

/** Accounting uses its explicit dependencies, independently of workflow publication fences and cancellation. */
export function adaptUsageRecorder(
  record: (usage: UsageRecord) => Effect.Effect<void>,
  span: Tracer.Span,
  annotations: Readonly<Record<string, unknown>>
) {
  return (usage: UsageRecord) =>
    Effect.runPromise(
      record(usage).pipe(
        Effect.annotateLogs(safeMetadata(annotations)),
        Effect.withParentSpan(span)
      )
    );
}

/** Resolve private credentials at the SDK call boundary without retaining queued secrets. */
export function adaptCredentialReader(read: Effect.Effect<string, StudyError>) {
  return (signal?: AbortSignal) => Effect.runPromise(read, { signal });
}
