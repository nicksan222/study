/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines small model agents for faithful PDF and pasted text conversion.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Specifies bounded cleanup outputs and faithful transcription instructions.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Workflow callers supply execution while shared platform services resolve models.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  visionTranscriptionInputSchema,
  visionTranscriptionOutputSchema
} from '@study/contracts/ai/vision-transcription';
import { AgentRule } from '@study/contracts/settings/schemas';

import { defineAgent } from '#server/platform/definitions/define-agent';

import { visionTranscriptionAgent } from './vision-transcription.ts';

export const pdfConversionAgent = defineAgent({
  id: 'pdf-text-conversion',
  customRules: [AgentRule.Transcription],
  input: visionTranscriptionInputSchema,
  output: visionTranscriptionOutputSchema,
  model: 'tiny',
  instructions: visionTranscriptionAgent.instructions,
  prompt: visionTranscriptionAgent.prompt,
  mode: 'object'
});
