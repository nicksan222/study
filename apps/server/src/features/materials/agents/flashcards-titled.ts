/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Generates titled flashcards using the existing evidence grounded agent.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses the same source tools and model tier as untitled generation.                      │
 * │ - Requires both a generated title and canonical material content.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The generation workflow owns validation, persistence and publication fencing.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { promptInputSchema } from '@study/contracts/ai/shared';
import { titledFlashcardsGenerationOutputSchema } from '@study/contracts/materials/schemas';

import { defineAgent } from '#server/platform/definitions/define-agent';

import { flashcardsAgent } from './flashcards.ts';
import { titleInstructions } from './generated-title.ts';

export const flashcardsTitledAgent = defineAgent({
  id: 'flashcards-titled',
  input: promptInputSchema,
  output: titledFlashcardsGenerationOutputSchema,
  model: 'medium',
  mode: 'object',
  tools: flashcardsAgent.tools,
  prompt: flashcardsAgent.prompt,
  instructions: (language) => `${flashcardsAgent.instructions(language)} ${titleInstructions}`
});
