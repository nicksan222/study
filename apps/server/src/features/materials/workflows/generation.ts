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

import type { promptInputSchema } from '@study/contracts';
import { failureSchema, StudyError } from '@study/contracts';
import type { Failure } from '@study/contracts';
import { materialGenerationRequestedSchema } from '@study/contracts';
import { materialVersionIdSchema } from '@study/contracts';
import { contentInputKey, contentInputSchema } from '@study/contracts';
import { materialGenerationPublicationSchema } from '@study/contracts';
import type { quizGenerationConfigSchema } from '@study/contracts';
import type { MaterialContentInput } from '@study/contracts';
import {
  generateAgent,
  Database,
  defineActivity,
  publicationActivity,
  defineWorkflow,
  defineWorkflowHandler,
  retryResumableActivity
} from '@study/server';
import type { ContextPreparation, AgentDefinition } from '@study/server';
import { Effect, Schema } from 'effect';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { flashcardsTitledAgent } from '#server/features/materials/agents/flashcards-titled';
import { quizAgent } from '#server/features/materials/agents/quiz';
import { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import {
  assertQuestionSpec,
  assertQuizConfig
} from '#server/features/materials/decoders/question-spec';
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
    const prompt = `Title: ${initial.title}\nStudent instruction (data): ${initial.instruction ?? ''}${initial.questionSpec ? `\nProduce exactly one ${initial.questionSpec.kind === 'choice' ? 'choice (single_choice or multiple_choice)' : 'open'} question.` : ''}${quizRequirements(initial.quizConfig)}`;

    const generationActivity = defineActivity({
      // Preserve the recorded activity name for replay of queued quiz and flashcard work.
      name: 'generate-material-1',
      success: materialGenerationPublicationSchema,

      execute: function* () {
        yield* preflight;
        const options = {
          scope: 'generate-material-1',
          maxRetries: 0,
          sources: {
            referenceSchema: contentInputSchema,
            documents: initial.inputs.map((input) => ({
              key: contentInputKey(input),
              reference: input,
              load: materials.contentInput(input)
            }))
          },
          preflight
        };
        const definition: AgentDefinition<
          typeof promptInputSchema,
          Schema.ConstraintDecoder<MaterialContentInput>
        > & { context: ContextPreparation } = {
          quiz: quizAgent,
          flashcards: flashcardsAgent
        }[event.kind];
        const titledDefinition: AgentDefinition<
          typeof promptInputSchema,
          Schema.ConstraintDecoder<{ title: string; content: MaterialContentInput }>
        > & { context: ContextPreparation } = {
          quiz: quizTitledAgent,
          flashcards: flashcardsTitledAgent
        }[event.kind];
        const generated = initial.autoTitle
          ? yield* generateAgent(titledDefinition, { prompt }, options).pipe(
              Effect.map(({ output, evidence }) => ({ ...output, evidence }))
            )
          : yield* generateAgent(definition, { prompt }, options).pipe(
              Effect.map(({ output, evidence }) => ({
                content: output,
                title: undefined,
                evidence
              }))
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

        const citations = yield* generated.evidence.citations(JSON.stringify(safeContent)).pipe(
          Effect.map((values) =>
            values.map(({ marker, reference, ...rest }) => ({
              ...rest,
              marker: BigInt(marker),
              input: reference
            }))
          )
        );

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
      }
    });

    const publish = (publication: typeof materialGenerationPublicationSchema.Type) =>
      publicationActivity(store, {
        name: 'publish-material',
        success: materialVersionIdSchema,

        execute: materials.publishMaterialGeneration(publication)
      });

    const publication = yield* retryResumableActivity(generationActivity);

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

function checkGeneratedLimits(
  content: (typeof materialGenerationPublicationSchema.Type)['content']
) {
  if (
    (content.kind === 'flashcards' && content.cards.length > 50) ||
    (content.kind === 'quiz' && content.questions.length > 10)
  )
    return Effect.fail(new StudyError('invalid_input', 'Generated content exceeds limits'));

  return Effect.void;
}

/** Constrain generation to the saved count, question kind and difficulty. */
function quizRequirements(config: typeof quizGenerationConfigSchema.Type | undefined) {
  if (!config) return '';

  const kinds = {
    mixed:
      'any combination of choice, open, fill_blank, true_false matching and ordering questions',
    matching:
      'only matching questions with 2 to 8 distinct term/definition pairs from the selected documents; each definition must match exactly one term. Never disclose associations in the prompt; cite evidence in the explanation',
    true_false:
      'only true_false statements, with boolean isTrue and an explanation that corrects any false statement',
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
