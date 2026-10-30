import { failureSchema, StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { materialGenerationRequestedSchema } from '@study/contracts/events';
import { materialVersionIdSchema } from '@study/contracts/ids';
import type { MaterialVersionId } from '@study/contracts/ids';
import { materialGenerationPublicationSchema } from '@study/contracts/materials/schemas';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { diagramAgent } from '#server/features/materials/agents/diagram';
import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { quizAgent } from '#server/features/materials/agents/quiz';
import { assertQuestionSpec } from '#server/features/materials/decoders/question-spec';
import { Materials } from '#server/features/materials/service/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { diagramFeedback } from '#server/platform/ai/diagram/validator';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

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
  const agents = yield* Agents;
  const { store } = yield* Database;
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
    Activity.make({
      name: 'notify-material-generation-failed',
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        materials.notifyMaterialGenerationFailed({
          requestId: event.requestId,
          generationEventId: event.eventId,
          errorKind: error.kind
        })
      )
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
      );
    let previous = '';
    let issue = '';

    for (let attempt = 1; attempt <= (event.kind === 'diagram' ? 3 : 1); attempt++) {
      const prompt = `Title: ${initial.title}\nStudent instruction (data): ${initial.instruction ?? ''}${initial.questionSpec ? `\nProduce exactly one ${initial.questionSpec.kind === 'choice' ? 'choice (single_choice or multiple_choice)' : 'open'} question.` : ''}${issue ? `\nPrevious diagram (data):\n${previous}\nValidation feedback: ${issue}` : ''}`;
      const publication = yield* retryResumableActivity(
        Activity.make({
          name: `generate-material-${attempt}`,
          success: materialGenerationPublicationSchema,
          error: failureSchema,
          execute: Effect.gen(function* () {
            yield* preflight;
            const catalog = createEvidenceCatalog<{ inputVersionId: MaterialVersionId }>([]);

            for (const [index, id] of initial.inputVersionIds.entries()) {
              const version = yield* materials.materialVersion({ id });

              if (version.content.kind !== 'document')
                return yield* Effect.fail(
                  new StudyError('invalid_input', 'Captured document is unavailable')
                );

              catalog.addDocument({
                key: String(id),
                name: `Document ${index + 1}`,
                reference: { inputVersionId: id },
                blocks: version.content.blocks
              });
            }

            const scoped = {
              ...agents,
              searchSources: (query: string) => Effect.sync(() => catalog.search(query))
            };
            const options = { maxRetries: 0, preflight: preflight.pipe(Effect.asVoid) };
            const content =
              event.kind === 'flashcards'
                ? yield* generateAgent(flashcardsAgent, { prompt }, options).pipe(
                    Effect.provideService(Agents, scoped)
                  )
                : event.kind === 'quiz'
                  ? yield* generateAgent(quizAgent, { prompt }, options).pipe(
                      Effect.provideService(Agents, scoped)
                    )
                  : yield* generateAgent(diagramAgent, { prompt }, options).pipe(
                      Effect.provideService(Agents, scoped)
                    );

            yield* Effect.try({
              try: () => assertQuestionSpec(initial.questionSpec, content),
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('invalid_input', 'Invalid quiz specification', { cause })
            });

            if (
              (content.kind === 'flashcards' && content.cards.length > 50) ||
              (content.kind === 'quiz' && content.questions.length > 10) ||
              (content.kind === 'diagram' && content.payload.length > 100_000)
            )
              return yield* Effect.fail(
                new StudyError('invalid_input', 'Generated content exceeds limits')
              );

            const safeContent =
              content.kind === 'flashcards'
                ? {
                    kind: 'flashcards' as const,
                    cards: content.cards.map(({ front, back }) => ({ front, back }))
                  }
                : content;

            if (JSON.stringify(safeContent).length > 100_000)
              return yield* Effect.fail(
                new StudyError('invalid_input', 'Generated content exceeds limits')
              );

            const citations = yield* Effect.try({
              try: () =>
                catalog
                  .citations(JSON.stringify(safeContent))
                  .map(({ marker, reference, ...rest }) => ({
                    marker: BigInt(marker),
                    ...reference,
                    ...rest
                  })),
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('invalid_input', 'Invalid citations', { cause })
            });

            if (citations.length === 0)
              return yield* Effect.fail(
                new StudyError('invalid_input', 'Generated content must cite captured evidence')
              );

            return {
              requestId: event.requestId,
              generationEventId: event.eventId,
              content: safeContent,
              citations
            };
          })
        })
      );

      if (publication.content.kind === 'diagram') {
        const result = yield* Activity.make({
          name: `validate-material-${attempt}`,
          success: Schema.NullOr(Schema.String),
          error: failureSchema,
          execute: diagramFeedback(publication.content.payload).pipe(
            Effect.map((value) => value ?? null)
          )
        });

        if (result !== null) {
          previous = publication.content.payload;
          issue = result;
          continue;
        }
      }

      return yield* Activity.make({
        name: 'publish-material',
        success: materialVersionIdSchema,
        error: failureSchema,
        execute: withPublicationGuard(store, materials.publishMaterialGeneration(publication))
      });
    }

    return yield* Effect.fail(new StudyError('invalid_input', 'Diagram could not be validated'));
  }).pipe(Effect.catch(notifyFailure));
}

export const materialGenerationHandler = ({
  event
}: typeof materialGenerationWorkflow.payloadSchema.Type) =>
  Effect.gen(() => generateMaterial(event));

export const materialGenerationRegistration = defineWorkflowHandler(materialGenerationWorkflow, {
  execute: materialGenerationHandler,
  triggers: [
    {
      subscription: 'material-generation',
      event: 'MaterialGenerationRequested',
      emits: ['MaterialPublished', 'MaterialGenerationFailed']
    }
  ]
});
