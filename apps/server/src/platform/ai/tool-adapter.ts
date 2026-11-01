import type { StudyError } from '@study/contracts/errors';
import { dynamicTool } from 'ai';
import { Effect } from 'effect';
import type { Context, Tracer } from 'effect';

import { standardSchema } from '#server/platform/ai/schema';
import type { AgentEnvironment, AgentTool } from '#server/platform/definitions/define-agent';
import { safeMetadata } from '#server/platform/observability/index';

export function adaptTool(
  definition: AgentTool,
  environment: AgentEnvironment,
  span: Tracer.Span,
  annotations: Readonly<Record<string, unknown>>,
  context: Context.Context<never>
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
        definition
          .execute(input, toolEnvironment)
          .pipe(
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
