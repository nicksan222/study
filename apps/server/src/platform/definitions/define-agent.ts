/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines typed feature agent declarations, including their input and output         │
 * │ schemas, model tier, prompt, tools, and source-search environment. defineAgent validates │
 * │ the stable identifier while preserving the declaration’s inferred types.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports CitationEvidence, AgentEnvironment, AgentTool, AgentDefinition, defineAgent.   │
 * │   DefineAgent validates the stable identifier while preserving the declaration’s         │
 * │   inferred types.                                                                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules use this typed declaration helper; it checks contracts but leaves domain │
 * │ data and business policy in the feature.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { sourceEvidenceSchema } from '@study/contracts/ai/sources';
import type { StudyError } from '@study/contracts/errors';
import type { AgentRule, ModelTier } from '@study/contracts/settings/schemas';
import type { ModelMessage } from 'ai';
import type { Effect, Schema } from 'effect';

export type CitationEvidence = typeof sourceEvidenceSchema.Type;

export interface AgentEnvironment {
  language: string | Effect.Effect<string, StudyError>;
  searchSources: (
    query: string,
    signal?: AbortSignal
  ) => Effect.Effect<readonly CitationEvidence[], StudyError>;
}

export interface ToolWiki {
  when: string;
  examples: readonly [string, ...string[]];
  limits: string;
}

const toolDeclaration = Symbol('AgentTool');

export interface AgentTool<
  Input extends Schema.ConstraintDecoder<unknown> = Schema.ConstraintDecoder<unknown>,
  Output = unknown,
  Requirements = never
> {
  readonly [toolDeclaration]: true;
  description: string;
  wiki: ToolWiki;
  input: Input;
  output: Schema.ConstraintCodec<Output, unknown, never, never>;
  mutates: boolean;
  execute(
    input: Input['Type'],
    environment: AgentEnvironment
  ): Effect.Effect<Output, StudyError, Requirements>;
}

export interface AgentDefinition<
  Input extends Schema.ConstraintDecoder<unknown>,
  Output extends Schema.ConstraintDecoder<unknown>,
  Requirements = never
> {
  id: string;
  input: Input;
  output: Output;
  model: ModelTier;
  /** Every agent explicitly selects at least one user preference category. */
  customRules: readonly [AgentRule, ...AgentRule[]];
  instructions: string | ((language: string) => string);
  prompt: (input: Input['Type']) => string | ModelMessage[];
  tools?: Record<string, AgentTool<Schema.ConstraintDecoder<unknown>, unknown, Requirements>>;
  mode?: 'text' | 'object';
}

export function defineAgent<
  Input extends Schema.ConstraintDecoder<unknown>,
  Output extends Schema.ConstraintDecoder<unknown>,
  Requirements,
  Definition extends AgentDefinition<Input, Output, Requirements>
>(definition: Definition & AgentDefinition<Input, Output, Requirements>): Definition {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id)) throw new RangeError('Invalid agent id');

  return definition;
}

/** Bind execution to the exact decoded input and validated result schemas. */
export function defineTool<
  Input extends Schema.ConstraintDecoder<object>,
  Output extends Schema.ConstraintCodec<unknown, unknown, never, never>,
  Requirements
>(definition: {
  description: string;
  wiki: ToolWiki;
  input: Input;
  output: Output;
  mutates: boolean;
  execute(
    input: NoInfer<Input['Type']>,
    environment: AgentEnvironment
  ): Effect.Effect<NoInfer<Output['Type']>, StudyError, Requirements>;
}): AgentTool<Input, Output['Type'], Requirements> {
  return { ...definition, [toolDeclaration]: true };
}
