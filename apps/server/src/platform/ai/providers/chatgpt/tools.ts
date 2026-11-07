/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Adapts explicitly declared agent tools to native OpenAI capabilities.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Maps the typed web search capability to the AI SDK provider tool.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Agent definitions own capability selection; OpenAI executes these tools remotely.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { openai } from '@ai-sdk/openai';

import type { ProviderTool } from '#server/platform/definitions/define-agent';

export function adaptProviderTool(definition: ProviderTool) {
  switch (definition.provider) {
    case 'openai.web_search':
      return openai.tools.webSearch({});
  }
}
