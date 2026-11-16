/** @file Native OpenAI capabilities available on the signed-in ChatGPT plan. */
import { OpenAiTool } from '@effect/ai-openai';

export const chatGptTools = { web_search: OpenAiTool.WebSearch({}) };
