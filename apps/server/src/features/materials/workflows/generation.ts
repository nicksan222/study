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
 * │ Effect Workflow owns durable execution; the materials service owns domain writes         │
 * │ performed by guarded activities.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { failureSchema, StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { materialGenerationRequestedSchema } from '@study/contracts/events';
import { materialVersionIdSchema } from '@study/contracts/ids';
import type { MaterialVersionId } from '@study/contracts/ids';
import type { materialGenerationSnapshotSchema } from '@study/contracts/materials/schemas';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { materialGenerationPublicationSchema } from '@study/contracts/materials/schemas';
import type { documentTextRangeSchema } from '@study/contracts/sources/schemas';
import { Effect, Schema, Option } from 'effect';
import { Activity } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { diagramAgent } from '#server/features/materials/agents/diagram';
import { documentTransformAgent } from '#server/features/materials/agents/document-transform';
import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { quizAgent } from '#server/features/materials/agents/quiz';
import {
  validateDocumentTransform,
  authorizedTransformAssets
} from '#server/features/materials/decoders/document-transform';
import { canonicalDocumentTransformOutput } from '#server/features/materials/decoders/document-transform-output';
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

type Captured = typeof runSelectionContextSchema.Type;

type Request = typeof materialGenerationSnapshotSchema.Type;

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
  const sessions = Option.getOrUndefined(yield* Effect.serviceOption(Conversations));
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
      .pipe(
        Effect.andThen(
          initial.documentTransform
            ? sessions
              ? sessions.documentTransformContext({ requestId: initial.id }).pipe(Effect.asVoid)
              : Effect.fail(new StudyError('unsupported', 'Session service is unavailable'))
            : Effect.void
        ),
        Effect.provideService(Database, database)
      );
    const promptForAttempt = (previous: string, issue: string) =>
      `Title: ${initial.title}\nStudent instruction (data): ${initial.instruction ?? ''}${initial.questionSpec ? `\nProduce exactly one ${initial.questionSpec.kind === 'choice' ? 'choice (single_choice or multiple_choice)' : 'open'} question.` : ''}${issue ? `\nPrevious diagram (data):\n${previous}\nValidation feedback: ${issue}` : ''}`;

    const generationActivity = (attempt: number, prompt: string) =>
      initial.documentTransform
        ? generateDocumentTransform({
            context: sessions
              ? sessions.documentTransformContext({ requestId: initial.id })
              : Effect.fail(new StudyError('unsupported', 'Session service is unavailable')),
            request: initial,
            eventId: event.eventId,
            preflight
          })
        : Activity.make({
            name: `generate-material-${attempt}`,
            success: materialGenerationPublicationSchema,
            error: failureSchema,
            execute: Effect.gen(function* () {
              yield* preflight;
              const catalog = createEvidenceCatalog<{ inputVersionId: MaterialVersionId }>([]);

              for (const [index, id] of initial.inputVersionIds.entries()) {
                const version = yield* materials.materialVersion({ id });

                const document = evidenceDocument(version.content);

                if (!document)
                  return yield* Effect.fail(
                    new StudyError('invalid_input', 'Captured document is unavailable')
                  );

                catalog.addDocument({
                  key: String(id),
                  name: `Document ${index + 1}`,
                  reference: { inputVersionId: id },
                  blocks: document.blocks
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
        execute: withPublicationGuard(
          store,
          publication.content.kind === 'document'
            ? sessions
              ? sessions.publishDocumentTransform(publication)
              : Effect.fail(new StudyError('unsupported', 'Session service is unavailable'))
            : materials.publishMaterialGeneration(publication)
        )
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

function evidenceDocument(content: MaterialVersionDetailDto['content']) {
  if (content.kind === 'document') return content;

  return 'extracted' in content ? content.extracted?.document : undefined;
}

function generateDocumentTransform(input: {
  context: Effect.Effect<Captured, StudyError, Database>;
  request: Request;
  eventId: string;
  preflight: Effect.Effect<void, StudyError>;
}) {
  return Activity.make({
    name: 'generate-material-1',
    success: materialGenerationPublicationSchema,
    error: failureSchema,
    execute: Effect.gen(function* () {
      yield* input.preflight;
      const agents = yield* Agents;
      const context = yield* input.context;
      const { request } = input;
      const catalog = createEvidenceCatalog<{
        inputVersionId: MaterialVersionId;
        target: typeof documentTextRangeSchema.Type;
      }>([]);

      for (const input of context.inputs)
        for (const [index, excerpt] of input.excerpts.entries())
          catalog.addDocument({
            key: `${input.versionId}:${index}`,
            name: input.name,
            reference: {
              inputVersionId: input.versionId,
              target: {
                versionId: input.versionId,
                documentId: input.documentId,
                blockId: excerpt.blockId,
                start: excerpt.start,
                end: excerpt.end
              }
            },
            quoteLimit: 100000,
            blocks: [{ text: excerpt.text, blockOrdinal: excerpt.blockOrdinal }]
          });

      const editTargetVersionId = request.documentTransform?.editTargetVersionId;
      const editTarget = context.inputs.find((target) => target.versionId === editTargetVersionId);

      if (
        editTargetVersionId !== undefined &&
        (!editTarget?.document || editTarget.scope.kind !== 'document')
      )
        return yield* Effect.fail(
          new StudyError('invalid_input', 'Exact editable target is unavailable')
        );

      const captured = {
        editTarget: editTarget
          ? {
              materialId: editTarget.materialId,
              versionId: editTarget.versionId,
              documentId: editTarget.documentId,
              document: editTarget.document
            }
          : undefined,
        title: request.title,
        operations: request.documentTransform?.operations,
        instruction: context.instruction,
        preferences: context.preferences,
        assets: authorizedTransformAssets(context),
        messages: context.messages,
        excludedMessages: context.excludedMessages,
        inputs: context.inputs.map((target) => ({
          role: editTarget
            ? target.versionId === editTargetVersionId
              ? 'editable_target'
              : 'supporting_evidence'
            : 'source',
          versionId: target.versionId,
          name: target.name,
          excerpts: target.excerpts
        }))
      };
      const output = yield* generateAgent(
        documentTransformAgent,
        {
          prompt: JSON.stringify(captured, (_, value: unknown) =>
            typeof value === 'bigint' ? String(value) : value
          )
        },
        { maxRetries: 0, preflight: input.preflight }
      ).pipe(
        Effect.provideService(Agents, {
          ...agents,
          searchSources: (query: string) => Effect.sync(() => catalog.search(query))
        })
      );

      return yield* Effect.try({
        try: () => {
          const content = canonicalDocumentTransformOutput(output, editTarget?.document?.blocks);
          const citations = catalog
            .citations(
              [
                ...content.content.blocks.map((block) => block.text),
                ...content.report.notes.map((note) => note.explanation)
              ].join('\n')
            )
            .map(({ marker, reference, ...citation }) => ({
              marker: BigInt(marker),
              ...reference,
              ...citation
            }));
          const publication = {
            ...content,
            requestId: request.id,
            generationEventId: input.eventId,
            language: context.preferences.language,
            citations
          };

          validateDocumentTransform(context, publication, editTargetVersionId);

          return publication;
        },
        catch: (cause) =>
          cause instanceof StudyError
            ? cause
            : new StudyError('invalid_input', 'Invalid Document output', { cause })
      });
    })
  });
}
