import { failureSchema } from '@study/contracts/errors';
import { sourceIndexedSchema } from '@study/contracts/events';
import { materialDetailSchema } from '@study/contracts/materials/schemas';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Materials } from '#server/features/materials/service/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';

const resultSchema = Schema.Struct({
  original: materialDetailSchema,
  extracted: materialDetailSchema
});

export const sourceIndexedWorkflow = defineWorkflow({
  name: 'source-material-projection',
  version: 1,
  payload: Schema.Struct({ event: sourceIndexedSchema }),
  success: resultSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const sourceIndexedHandler = ({ event }: typeof sourceIndexedWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const materials = yield* Materials;
    const { store } = yield* Database;

    return yield* Activity.make({
      name: 'project-source',
      success: resultSchema,
      error: failureSchema,
      execute: withPublicationGuard(store, materials.projectSource(event))
    });
  });

export const sourceIndexedRegistration = defineWorkflowHandler(sourceIndexedWorkflow, {
  execute: sourceIndexedHandler,
  triggers: [
    {
      subscription: 'source-material-projection',
      event: 'SourceIndexed',
      emits: ['MaterialPublished']
    }
  ]
});
