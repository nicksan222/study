/** @file Resolves native provider tools declared by feature agents. */
import type { Tool } from 'effect/ai';

import type { AiModel } from '#server/platform/ai/model';
import type { ProviderTool } from '#server/platform/definitions/define-agent';

type ProviderTools = Partial<Record<ProviderTool['provider'], Tool.Any>>;

export function withProviderTools<T extends AiModel>(
  model: T,
  providerTools: ProviderTools,
  supportsMixedTools = true
) {
  return Object.assign(model, { providerTools, supportsMixedTools });
}

export function adaptProviderTool(
  model: AiModel,
  definition: ProviderTool,
  hasFunctionTools = false
): Tool.Any | undefined {
  if (hasFunctionTools && model.supportsMixedTools === false) return undefined;

  return model.providerTools?.[definition.provider];
}
