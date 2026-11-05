import { failureSchema } from '@study/contracts/errors';
import { transformSuggestionRequestedSchema } from '@study/contracts/events';
import { Schema } from 'effect';

import { defineWorkflow } from '#server/platform/definitions/define-workflow';

export const transformSuggestionWorkflow = defineWorkflow({
  name: 'transform-suggestion',
  version: 1,
  payload: Schema.Struct({ event: transformSuggestionRequestedSchema }),
  success: Schema.String,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});
