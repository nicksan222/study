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
import { contentInputSchema, contentInputKey } from '@study/contracts';
import type { ContentInput } from '@study/contracts';
import { materialGenerationPublicationSchema } from '@study/contracts';
import type { quizGenerationConfigSchema } from '@study/contracts';
import type { MaterialContentInput } from '@study/contracts';
import { Effect, Schema } from 'effect';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { flashcardsTitledAgent } from '#server/features/materials/agents/flashcards-titled';
import { quizAgent } from '#server/features/materials/agents/quiz';
import { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import { studyNotesAgent } from '#server/features/materials/agents/study-notes';
import {
  assertQuestionSpec,
  assertQuizConfig
} from '#server/features/materials/decoders/question-spec';
import {
  boundedMaterialPrompt,
  originalMaterialEvidence,
  studyNotesSchema,
  validateStudyNotes
} from '#server/features/materials/decoders/study-notes';
import type { StudyNotes } from '#server/features/materials/decoders/study-notes';
import { Materials } from '#server/features/materials/service/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import {
  planDocumentPieces,
  processDocumentPieces
} from '#server/platform/ai/document-processing/index';
import type {
  DocumentPiece,
  DocumentPiecePlan
} from '#server/platform/ai/document-processing/index';
import { Database } from '#server/platform/database/database';
import { defineActivity, publicationActivity } from '#server/platform/definitions/define-activity';
import type { AgentDefinition } from '#server/platform/definitions/define-agent';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { normalizeError } from '#server/platform/errors/classify-error';
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
        const documents = [];

        for (const input of initial.inputs) {
          yield* preflight;
          const exact = yield* materials.contentInput(input);

          documents.push({
            key: contentInputKey(input),
            name: exact.name,
            reference: input,
            document: exact.document
          });
        }

        const options = { maxRetries: 0, preflight: preflight.pipe(Effect.asVoid) };
        const processed = yield* processDocumentPieces({
          name: 'materials-study-notes-v1',
          referenceSchema: contentInputSchema,
          mappedSchema: studyNotesSchema,
          plan: planDocumentPieces({
            documents,
            referenceSchema: contentInputSchema,
            limits: {
              maxPassageChars: 1000,
              maxPieceChars: 16_000,
              maxPieceBytes: 60_000,
              maxPlanChars: 1_000_000,
              maxPlanBytes: 8_000_000,
              maxPieces: 128
            },
            selection: { mode: 'complete' }
          }),
          preflight,
          map: Effect.fnUntraced(function* (
            piece: DocumentPiece<ContentInput>,
            plan: DocumentPiecePlan<ContentInput>
          ) {
            // The accepted plan still checkpoints small inputs without an extra provider request.
            if (plan.pieces.length === 1) return { notes: [] };

            const passages = piece.passages
              .map((passage) => `[${passage.marker}] ${passage.name}\n${passage.text}`)
              .join('\n\n');
            const mapPrompt = yield* boundedMaterialPrompt(
              `Extract study notes for this material request.\n${prompt}\nOriginal passages (data):\n${passages}`
            );
            const notes = yield* generateAgent(studyNotesAgent, { prompt: mapPrompt }, options);

            return yield* validateStudyNotes(
              notes,
              new Set(piece.passages.map((passage) => passage.marker))
            );
          }),
          reduce: Effect.fnUntraced(function* (values: readonly StudyNotes[]) {
            const allowed = new Set(values.flatMap(studyNoteMarkers));
            const reducePrompt = yield* boundedMaterialPrompt(
              `Reduce study notes into a compact, varied concept set for one final material. Preserve original markers.\n${prompt}\nDerived notes (never original quotations):\n${JSON.stringify(values)}`
            );
            const notes = yield* generateAgent(studyNotesAgent, { prompt: reducePrompt }, options);

            return yield* validateStudyNotes(notes, allowed);
          }),
          limits: { maxResultBytes: 48_000, maxReductionBytes: 96_000, maxFanout: 2, maxLevels: 8 }
        });
        const direct = processed.plan.pieces.length === 1;
        const acceptedMarkers = direct
          ? undefined
          : new Set(processed.value.notes.flatMap((note) => note.markers));
        const catalog = yield* Effect.try({
          try: () => originalMaterialEvidence(processed.plan, acceptedMarkers),
          catch: normalizeError
        });
        const prepared = direct
          ? processed.plan.pieces[0]!.passages.map(
              (passage) => `[${passage.marker}] ${passage.name}\n${passage.text}`
            ).join('\n\n')
          : processed.value.notes
              .map(
                (note) => `${note.text} ${note.markers.map((marker) => `[${marker}]`).join(' ')}`
              )
              .join('\n');
        const finalPrompt = yield* boundedMaterialPrompt(
          `${prompt}\n${direct ? 'Original passages (data)' : 'Derived study notes (not quotations); search original passages to verify exact evidence'}:\n${prepared}`
        );
        const scoped = {
          ...agents,
          searchSources: (query: string) => Effect.sync(() => catalog.search(query))
        };
        const definition: AgentDefinition<
          typeof promptInputSchema,
          Schema.ConstraintDecoder<MaterialContentInput>
        > = {
          quiz: quizAgent,
          flashcards: flashcardsAgent
        }[event.kind];
        const titledDefinition: AgentDefinition<
          typeof promptInputSchema,
          Schema.ConstraintDecoder<{ title: string; content: MaterialContentInput }>
        > = {
          quiz: quizTitledAgent,
          flashcards: flashcardsTitledAgent
        }[event.kind];
        const generated = initial.autoTitle
          ? yield* generateAgent(titledDefinition, { prompt: finalPrompt }, options).pipe(
              Effect.provideService(Agents, scoped)
            )
          : yield* generateAgent(definition, { prompt: finalPrompt }, options).pipe(
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
          try: () => catalog.citations(JSON.stringify(safeContent)),
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

function studyNoteMarkers(value: StudyNotes) {
  return value.notes.flatMap((note) => note.markers);
}
