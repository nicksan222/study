/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Generates titled quiz using the existing evidence grounded agent.                  │
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
import { titledQuizGenerationOutputSchema } from '@study/contracts/materials/schemas';
import { AgentRule } from '@study/contracts/settings/schemas';

import { defineAgent } from '#server/platform/definitions/define-agent';

import { titleInstructions } from './generated-title.ts';
import { quizAgent } from './quiz.ts';

export const quizTitledAgent = defineAgent({
  id: 'quiz-titled',
  customRules: [AgentRule.Quizzes, AgentRule.Titles],
  input: promptInputSchema,
  output: titledQuizGenerationOutputSchema,
  model: 'medium',
  mode: 'object',
  tools: quizAgent.tools,
  prompt: quizAgent.prompt,
  instructions: (language) => `${quizAgent.instructions(language)} ${titleInstructions}`
});
