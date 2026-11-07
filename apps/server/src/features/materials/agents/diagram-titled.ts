/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Generates titled diagram using the existing evidence grounded agent.               │
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
import { titledDiagramGenerationOutputSchema } from '@study/contracts/materials/schemas';
import { AgentRule } from '@study/contracts/settings/schemas';

import { defineAgent } from '#server/platform/definitions/define-agent';

import { diagramAgent } from './diagram.ts';
import { titleInstructions } from './generated-title.ts';

export const diagramTitledAgent = defineAgent({
  id: 'diagram-titled',
  customRules: [AgentRule.Diagrams, AgentRule.Titles],
  input: promptInputSchema,
  output: titledDiagramGenerationOutputSchema,
  model: 'smart',
  mode: 'object',
  tools: diagramAgent.tools,
  prompt: diagramAgent.prompt,
  instructions: (language) => `${diagramAgent.instructions(language)} ${titleInstructions}`
});
