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

import type { promptInputSchema } from '@study/contracts/ai/shared';
import { failureSchema, StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { materialGenerationRequestedSchema } from '@study/contracts/events';
import { materialVersionIdSchema } from '@study/contracts/ids';
import { contentInputKey } from '@study/contracts/inputs';
import type { ContentInput } from '@study/contracts/inputs';
import { materialGenerationPublicationSchema } from '@study/contracts/materials/schemas';
import type { quizGenerationConfigSchema } from '@study/contracts/materials/schemas';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { diagramAgent } from '#server/features/materials/agents/diagram';
import { diagramTitledAgent } from '#server/features/materials/agents/diagram-titled';
import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { flashcardsTitledAgent } from '#server/features/materials/agents/flashcards-titled';
import { quizAgent } from '#server/features/materials/agents/quiz';
import { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import {
  assertQuestionSpec,
  assertQuizConfig
} from '#server/features/materials/decoders/question-spec';
import { Materials } from '#server/features/materials/service/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { diagramFeedback } from '#server/platform/ai/diagram/validator';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import type { AgentDefinition } from '#server/platform/definitions/define-agent';
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
      )
      .pipe(Effect.provideService(Database, database));
    const promptForAttempt = (previous: string, issue: string) =>
      `Title: ${initial.title}\nStudent instruction (data): ${initial.instruction ?? ''}${initial.questionSpec ? `\nProduce exactly one ${initial.questionSpec.kind === 'choice' ? 'choice (single_choice or multiple_choice)' : 'open'} question.` : ''}${quizRequirements(initial.quizConfig)}${issue ? `\nPrevious diagram (data):\n${previous}\nValidation feedback: ${issue}` : ''}`;

    const generationActivity = (attempt: number, prompt: string) =>
      Activity.make({
        name: `generate-material-${attempt}`,
        success: materialGenerationPublicationSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          yield* preflight;
          const catalog = createEvidenceCatalog<{ input: ContentInput }>([]);

          for (const input of initial.inputs) {
            const exact = yield* materials.contentInput(input);

            catalog.addDocument({
              key: contentInputKey(input),
              name: exact.name,
              reference: { input },
              blocks: exact.document.blocks
            });
          }

          const scoped = {
            ...agents,
            searchSources: (query: string) => Effect.sync(() => catalog.search(query))
          };
          const options = { maxRetries: 0, preflight: preflight.pipe(Effect.asVoid) };
          const definition: AgentDefinition<
            typeof promptInputSchema,
            Schema.ConstraintDecoder<MaterialContentInput>
          > = {
            quiz: quizAgent,
            flashcards: flashcardsAgent,
            diagram: diagramAgent
          }[event.kind];
          const titledDefinition: AgentDefinition<
            typeof promptInputSchema,
            Schema.ConstraintDecoder<{ title: string; content: MaterialContentInput }>
          > = {
            quiz: quizTitledAgent,
            flashcards: flashcardsTitledAgent,
            diagram: diagramTitledAgent
          }[event.kind];
          const generated = initial.autoTitle
            ? yield* generateAgent(titledDefinition, { prompt }, options).pipe(
                Effect.provideService(Agents, scoped)
              )
            : yield* generateAgent(definition, { prompt }, options).pipe(
                Effect.map((content) => ({ content, title: undefined })),
                Effect.provideService(Agents, scoped)
              );
          const { content } = generated;

          yield* Effect.try({
            try: () => {
              assertQuestionSpec(initial.questionSpec, content);
              assertQuizConfig(initial.quizConfig, content);
            },
            catch: (cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('invalid_input', 'Invalid quiz specification', { cause })
          });

          yield* checkGeneratedLimits(content);

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
            title: generated.title,
            content: safeContent,
            citations
          };
        })
      });

    const publish = (publication: typeof materialGenerationPublicationSchema.Type) =>
      Activity.make({
        name: 'publish-material',
        success: materialVersionIdSchema,
        error: failureSchema,
        execute: withPublicationGuard(store, materials.publishMaterialGeneration(publication))
      });

    let previous = '';
    let issue = '';

    for (let attempt = 1; attempt <= (event.kind === 'diagram' ? 3 : 1); attempt++) {
      const publication = yield* retryResumableActivity(
        generationActivity(attempt, promptForAttempt(previous, issue))
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

      return yield* publish(publication);
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

function checkGeneratedLimits(
  content: (typeof materialGenerationPublicationSchema.Type)['content']
) {
  if (
    (content.kind === 'flashcards' && content.cards.length > 50) ||
    (content.kind === 'quiz' && content.questions.length > 10) ||
    (content.kind === 'diagram' && content.payload.length > 100_000)
  )
    return Effect.fail(new StudyError('invalid_input', 'Generated content exceeds limits'));

  return Effect.void;
}

/** Builds generation instructions from the requested quiz shape, including the single-marker rule for blank prompts. */
function quizRequirements(config: typeof quizGenerationConfigSchema.Type | undefined) {
  if (!config) return '';

  const kinds = {
    mixed: 'any combination of choice, open, fill_blank and ordering questions',
    ordering:
      'only ordering questions with 2 to 10 distinct steps or events in canonical chronological or process order in items; ground the sequence in selected documents, put citations in explanation and do not number items',
    choice: 'only choice questions (single_choice or multiple_choice)',
    open: 'only open questions',
    fill_blank:
      'only fill_blank questions with exactly one ____ marker in each prompt and a short referenceAnswer containing the missing word or phrase'
  };
  const difficulties = {
    easy: 'direct recall and foundational understanding',
    balanced: 'a balance of recall, understanding and application',
    challenging: 'application, analysis and inference grounded in the sources'
  };

  return `\nQuiz requirements: produce exactly ${config.questionCount} questions. Question kind: ${kinds[config.questionKind]}. Every choice question must contain exactly ${config.choiceCount} answer options. Difficulty: ${config.difficulty} (${difficulties[config.difficulty]}).`;
}
