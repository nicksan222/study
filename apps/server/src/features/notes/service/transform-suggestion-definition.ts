/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the durable contract for generating transformation field suggestions.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Shares typed payloads and results between request orchestration and execution.         │
 * │ - Keeps event identity stable for checkpointed suggestion retries.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This descriptor contains no handler or persistence logic; workflows own execution.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts';
import { transformSuggestionRequestedSchema } from '@study/contracts';
import { defineWorkflow } from '@study/server';
import { Schema } from 'effect';

export const transformSuggestionWorkflow = defineWorkflow({
  name: 'transform-suggestion',
  version: 1,
  payload: Schema.Struct({ event: transformSuggestionRequestedSchema }),
  success: Schema.String,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});
