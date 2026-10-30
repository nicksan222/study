import type { sourceEvidenceSchema } from '@study/contracts/ai/sources';
import type { StudyError } from '@study/contracts/errors';
import type { ModelMessage } from 'ai';
import type { Effect, Schema } from 'effect';

export type ModelTier = 'tiny' | 'medium' | 'smart';

export type CitationEvidence = typeof sourceEvidenceSchema.Type;

export interface AgentEnvironment {
  language: string | Effect.Effect<string, StudyError>;
  searchSources: (
    query: string,
    signal?: AbortSignal
  ) => Effect.Effect<readonly CitationEvidence[], StudyError>;
}

export interface AgentTool<
  Input extends Schema.ConstraintDecoder<unknown> = Schema.ConstraintDecoder<unknown>,
  Output = unknown
> {
  description: string;
  input: Input;
  execute(input: Input['Type'], environment: AgentEnvironment): Effect.Effect<Output, StudyError>;
}

export interface AgentDefinition<
  Input extends Schema.ConstraintDecoder<unknown>,
  Output extends Schema.ConstraintDecoder<unknown>
> {
  id: string;
  input: Input;
  output: Output;
  model: ModelTier;
  instructions: string | ((language: string) => string);
  prompt: (input: Input['Type']) => string | ModelMessage[];
  tools?: Record<string, AgentTool>;
  mode?: 'text' | 'object';
}

export function defineAgent<
  Input extends Schema.ConstraintDecoder<unknown>,
  Output extends Schema.ConstraintDecoder<unknown>,
  Definition extends AgentDefinition<Input, Output>
>(definition: Definition & AgentDefinition<Input, Output>): Definition {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id)) throw new RangeError('Invalid agent id');

  return definition;
}
