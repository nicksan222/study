/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Declares the optional web search capability independently of the selected provider │
 * │ implementation.                                                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Supplies the read only declaration and agent facing capability guide.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only agents selecting this tool receive search when their provider supports it.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineProviderTool } from '#server/platform/definitions/define-agent';

export const webSearchTool = defineProviderTool({
  provider: 'web_search',
  description:
    'Search the web using the selected provider for current information and supporting sources.',
  mutates: false,
  wiki: {
    when: 'Search online when a question needs current facts or information beyond captured sources.',
    examples: ['Check the latest research on this topic.'],
    limits:
      'Read only. Cite web sources with Markdown links; reserve numbered citations for captured passages.'
  }
});
