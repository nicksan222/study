/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Attaches optional provider capabilities to models for provider independent feature │
 * │ agent execution.                                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves declared provider tools from the selected model capabilities.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider modules select native tools; the shared agent runner handles feature tool       │
 * │ execution.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { Tool } from 'ai';

import type { ProviderTool } from '#server/platform/definitions/define-agent';

type ProviderTools = Partial<Record<ProviderTool['provider'], Tool>>;

export function withProviderTools<T extends LanguageModelV3>(
  model: T,
  providerTools: ProviderTools,
  supportsMixedTools = true
) {
  return Object.assign(model, { providerTools, supportsMixedTools });
}

export function adaptProviderTool(
  model: LanguageModelV3,
  definition: ProviderTool,
  hasFunctionTools = false
): Tool | undefined {
  if (!('providerTools' in model)) return undefined;

  if (hasFunctionTools && 'supportsMixedTools' in model && model.supportsMixedTools === false)
    return undefined;

  return (model.providerTools as ProviderTools)[definition.provider];
}
