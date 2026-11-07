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
import { dynamicTool } from 'ai';
import { Cause, Effect, Exit, Schema } from 'effect';
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
  return dynamicTool({
    description: definition.description,
    inputSchema: standardSchema(Schema.toEncoded(Schema.toCodecJson(definition.input))),
    execute: (input, options) => {
      const toolEnvironment: AgentEnvironment = {
        ...environment,
        searchSources: (query, signal) =>
          environment.searchSources(query, signal ?? options.abortSignal)
      };

      return Effect.runPromiseWith(context)(
        Effect.gen(function* () {
          const identity = { toolCallId: options.toolCallId, toolName: progress?.name ?? '' };

          if (progress) yield* progress.emit({ type: 'tool-start', ...identity });

          const decoded = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(definition.input))(
            input
          ).pipe(
            Effect.mapError(
              (cause) => new StudyError('invalid_input', 'Invalid tool input', { cause })
            )
          );

          return yield* definition.execute(decoded, toolEnvironment).pipe(
            Effect.flatMap(Schema.encodeUnknownEffect(Schema.toCodecJson(definition.output))),
            Effect.mapError((error) =>
              error instanceof StudyError
                ? error
                : new StudyError('internal', 'Invalid tool result', { cause: error })
            ),
            Effect.tap(() =>
              progress
                ? progress.emit({ type: 'tool-finish', ...identity, outcome: 'success' })
                : Effect.void
            ),
            Effect.onExit((exit) =>
              progress && Exit.isFailure(exit)
                ? progress
                    .emit({
                      type: 'tool-finish',
                      ...identity,
                      outcome: Cause.hasInterruptsOnly(exit.cause) ? 'cancelled' : 'failure'
                    })
                    .pipe(Effect.ignore)
                : Effect.void
            )
          );
        }).pipe(
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
