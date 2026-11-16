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

import { promptInputSchema } from '@study/contracts';
import { titledQuizGenerationOutputSchema } from '@study/contracts';
import { AgentRule } from '@study/contracts';
import { defineAgent } from '@study/server';

import { titleInstructions } from './generated-title.ts';
import { quizAgent } from './quiz.ts';
import { materialStudyContext } from './study-context.ts';

export const quizTitledAgent = defineAgent({
  context: materialStudyContext,
  id: 'quiz-titled',
  purpose: 'quiz',
  recordInput: false,
  customRules: [AgentRule.Quizzes, AgentRule.Titles],
  input: promptInputSchema,
  output: titledQuizGenerationOutputSchema,
  model: 'medium',
  mode: 'object',
  tools: quizAgent.tools,
  prompt: quizAgent.prompt,
  instructions: (language) => `${quizAgent.instructions(language)} ${titleInstructions}`
});
