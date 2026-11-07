/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Declares the opt-in native OpenAI web search capability for agents.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Supplies the read-only provider declaration and agent-facing capability guide.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only agents that select this tool receive web search; the provider owns execution.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineProviderTool } from '#server/platform/definitions/define-agent';

export const webSearchTool = defineProviderTool({
  provider: 'openai.web_search',
  description: 'Search the web using OpenAI for current information and supporting sources.',
  mutates: false,
  wiki: {
    when: 'Search online when a question needs current facts or information beyond captured sources.',
    examples: ['Check the latest research on this topic.'],
    limits:
      'Read only. Cite web sources with Markdown links; reserve numbered citations for captured passages.'
  }
});
