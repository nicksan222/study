/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs durable material generation: gathers cited evidence, invokes the matching     │
 * │ agent, validates output, and publishes the resulting version.                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns durable orchestration and delegates domain writes to Materials service            │
 * │   activities.                                                                            │
 * │ - Uses checkpoints and publication guards around durable state changes.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Effect Workflow owns durable execution; the materials service owns domain                │
 * │ writes performed by guarded activities.                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  failureSchema,
  StudyError,
  materialGenerationRequestedSchema,
  materialVersionIdSchema
} from '@study/contracts';
import type { Failure, materialGenerationPublicationSchema } from '@study/contracts';
import {
  Database,
  publicationActivity,
  runProcedure,
  defineWorkflow,
  defineWorkflowHandler
} from '@study/server';
import { Effect, Schema } from 'effect';

import { materialGenerationProcedure } from '#server/features/materials/procedures/generation';
import { Materials } from '#server/features/materials/service/index';

export const materialGenerationWorkflow = defineWorkflow({
  name: 'material-generation',
  version: 1,
  payload: Schema.Struct({ event: materialGenerationRequestedSchema }),
  success: materialVersionIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

function* generateMaterial(event: (typeof materialGenerationWorkflow.payloadSchema.Type)['event']) {
  const materials = yield* Materials;
  const database = yield* Database;
  const { store } = database;
  const snapshot = materials
    .materialGeneration({ requestId: event.requestId, eventId: event.eventId, verifyOnly: true })
    .pipe(
      Effect.flatMap((value) => {
        if (
          event.causationId !== null ||
          event.correlationId !== event.requestId ||
          event.inputVersion !== 1 ||
          event.depth !== 0 ||
          value.id !== event.requestId ||
          value.projectId !== event.projectId ||
          value.kind !== event.kind
        )
          return Effect.fail(
            new StudyError('invalid_input', 'Material generation event identity mismatch')
          );

        return Effect.succeed(value);
      })
    );
  const notifyFailure = (error: Failure) =>
    publicationActivity(store, {
      name: 'notify-material-generation-failed',

      execute: materials.notifyMaterialGenerationFailed({
        requestId: event.requestId,
        generationEventId: event.eventId,
        errorKind: error.kind
      })
    }).pipe(Effect.flatMap(() => Effect.fail(error)));
  const initial = yield* snapshot;

  if (initial.resultVersionId !== null) return initial.resultVersionId;

  return yield* Effect.gen(function* () {
    const preflight = materials
      .materialGeneration({ requestId: event.requestId, eventId: event.eventId })
      .pipe(
        Effect.flatMap((value) =>
          value.resultVersionId === null
            ? Effect.void
            : Effect.fail(new StudyError('invalid_input', 'Generation already completed'))
        )
      )
      .pipe(Effect.provideService(Database, database));
    const publish = (publication: typeof materialGenerationPublicationSchema.Type) =>
      publicationActivity(store, {
        name: 'publish-material',
        success: materialVersionIdSchema,

        execute: materials.publishMaterialGeneration(publication)
      });

    const publication = yield* runProcedure(
      materialGenerationProcedure,
      { request: initial, generationEventId: event.eventId },
      { key: 'generate-material-1', preflight, retry: false }
    );

    return yield* publish(publication);
  }).pipe(Effect.catch(notifyFailure));
}

export const materialGenerationHandler = ({
  event
}: typeof materialGenerationWorkflow.payloadSchema.Type) =>
  Effect.gen(() => generateMaterial(event));

export const materialGenerationRegistration = defineWorkflowHandler(materialGenerationWorkflow, {
  workload: 'bulk',
  execute: materialGenerationHandler,
  triggers: [
    {
      subscription: 'material-generation',
      event: 'MaterialGenerationRequested',
      emits: ['MaterialPublished', 'MaterialGenerationFailed']
    }
  ]
});
