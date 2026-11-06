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
import type { StudyError } from '@study/contracts/errors';
import { dynamicTool } from 'ai';
import { Cause, Effect, Exit } from 'effect';
import type { Context, Tracer } from 'effect';

import { standardSchema } from '#server/platform/ai/schema';
import type { AgentEnvironment, AgentTool } from '#server/platform/definitions/define-agent';
import { safeMetadata } from '#server/platform/observability/index';

/**
 * Restore the captured Effect context for provider-invoked tools and forward cancellation.
 * When progress is enabled, publish tool identity and outcome around the actual execution.
 */
export function adaptTool(
  definition: AgentTool,
  environment: AgentEnvironment,
  span: Tracer.Span,
  annotations: Readonly<Record<string, unknown>>,
  context: Context.Context<never>,
  progress?: {
    name: string;
    emit: (event: typeof agentUpdateSchema.Type) => Effect.Effect<void, StudyError>;
  }
) {
  return dynamicTool({
    description: definition.description,
    inputSchema: standardSchema(definition.input),
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

          return yield* definition.execute(input, toolEnvironment).pipe(
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
export function adaptRequestCheck(
  check: Effect.Effect<void, StudyError>,
  span: Tracer.Span,
  annotations: Readonly<Record<string, unknown>>,
  context: Context.Context<never>
) {
  return (signal: AbortSignal | undefined) =>
    Effect.runPromiseWith(context)(
      check.pipe(Effect.annotateLogs(safeMetadata(annotations)), Effect.withParentSpan(span)),
      { signal }
    );
}
