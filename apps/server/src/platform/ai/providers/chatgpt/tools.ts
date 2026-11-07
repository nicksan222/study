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

export const chatGptTools = { web_search: openai.tools.webSearch({}) };
