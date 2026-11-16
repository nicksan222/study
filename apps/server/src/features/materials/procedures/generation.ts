/** @file Reusable durable material generation stages and bounded novelty repair. */
import { StudyError } from '@study/contracts';
import { contentInputKey, contentInputSchema } from '@study/contracts';
import { materialGenerationPublicationSchema } from '@study/contracts';
import type { quizGenerationConfigSchema } from '@study/contracts';
import {
  materialGenerationHistoryReferencesSchema,
  materialGenerationPlanSchema as generationPlanSchema,
  materialNoveltyReviewSchema as noveltyReviewSchema
} from '@study/contracts';
import type { MaterialContentInput, promptInputSchema } from '@study/contracts';
import {
  materialGenerationProcedureInputSchema,
  materialGenerationHistoryInputSchema,
  materialGenerationPlanProcedureInputSchema,
  materialGenerationCandidateInputSchema,
  materialNoveltyProcedureInputSchema
} from '@study/contracts';
import { generateAgent, Database, defineProcedure, runProcedure } from '@study/server';
import type { ContextPreparation, AgentDefinition } from '@study/server';
import type { Schema } from 'effect';
import { Effect } from 'effect';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { flashcardsTitledAgent } from '#server/features/materials/agents/flashcards-titled';
import { generationPlanAgent } from '#server/features/materials/agents/generation-plan';
import { noveltyReviewAgent } from '#server/features/materials/agents/novelty-review';
import { quizAgent } from '#server/features/materials/agents/quiz';
import { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import {
  duplicateMaterialItems,
  materialRepairFeedback,
  materialGenerationPrompt
} from '#server/features/materials/decoders/generation-novelty';
import {
  assertQuestionSpec,
  assertQuizConfig
} from '#server/features/materials/decoders/question-spec';
import { Materials } from '#server/features/materials/service/index';

/** Every stage revalidates the captured request before provider access. */
function generationPreflight(input: typeof materialGenerationProcedureInputSchema.Type) {
  return Effect.gen(function* () {
    const materials = yield* Materials;
    const database = yield* Database;

    return materials
      .materialGeneration({ requestId: input.request.id, eventId: input.generationEventId })
      .pipe(
        Effect.flatMap((value) =>
          value.resultVersionId === null
            ? Effect.void
            : Effect.fail(new StudyError('invalid_input', 'Generation already completed'))
        ),
        Effect.provideService(Database, database)
      );
  });
}

const materialHistoryProcedure = defineProcedure({
  id: 'material-novelty-history-v1',
  purpose: 'history',
  input: materialGenerationHistoryInputSchema,
  output: materialGenerationHistoryReferencesSchema,
  execute: Effect.fnUntraced(function* ({
    requestId
  }: typeof materialGenerationHistoryInputSchema.Type) {
    const materials = yield* Materials;
    const { items, limited } = yield* materials.materialGenerationHistory({ requestId });

    return { versions: [...new Set(items.map(({ versionId }) => versionId))], limited };
  })
});

const materialPlanProcedure = defineProcedure({
  id: 'material-generation-plan-v1',
  purpose: 'plan',
  input: materialGenerationPlanProcedureInputSchema,
  output: generationPlanSchema,
  execute: Effect.fnUntraced(function* (
    input: typeof materialGenerationPlanProcedureInputSchema.Type
  ) {
    const materials = yield* Materials;
    const history = yield* materials.materialGenerationHistory({
      requestId: input.request.id,
      snapshot: input.history
    });
    const preflight = yield* generationPreflight(input);
    const generated = yield* generateAgent(
      generationPlanAgent,
      { kind: input.request.kind, request: input.prompt, history },
      {
        scope: 'material-generation-plan-v1',
        maxSteps: 3,
        maxRetries: 0,
        sources: {
          referenceSchema: contentInputSchema,
          documents: input.request.inputs.map((reference) => ({
            key: contentInputKey(reference),
            reference,
            load: materials.contentInput(reference)
          }))
        },
        preflight
      }
    );

    return generated.output;
  })
});

const materialNoveltyProcedure = defineProcedure({
  id: 'material-novelty-review-v1',
  purpose: 'novelty',
  input: materialNoveltyProcedureInputSchema,
  output: noveltyReviewSchema,
  execute: Effect.fnUntraced(function* (input: typeof materialNoveltyProcedureInputSchema.Type) {
    const materials = yield* Materials;
    const history = yield* materials.materialGenerationHistory({
      requestId: input.request.id,
      snapshot: input.history
    });

    const preflight = yield* generationPreflight(input);

    return yield* generateAgent(
      noveltyReviewAgent,
      { history, candidate: input.candidate },
      { maxSteps: 1, maxRetries: 0, preflight }
    );
  })
});

const materialCandidateProcedure = defineProcedure({
  id: 'material-candidate-v1',
  purpose: 'draft',
  input: materialGenerationCandidateInputSchema,
  output: materialGenerationPublicationSchema,
  execute: Effect.fnUntraced(function* (input: typeof materialGenerationCandidateInputSchema.Type) {
    const { request, generationEventId, scope } = input;
    const preflight = yield* generationPreflight(input);

    yield* preflight;
    const materials = yield* Materials;
    const history = yield* materials.materialGenerationHistory({
      requestId: request.id,
      snapshot: input.history
    });
    const prompt = materialGenerationPrompt(input.prompt, input.plan, history, input.feedback);
    const options = {
      scope,
      maxRetries: 0,
      sources: {
        referenceSchema: contentInputSchema,
        documents: request.inputs.map((input) => ({
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
    }[request.kind];
    const titledDefinition: AgentDefinition<
      typeof promptInputSchema,
      Schema.ConstraintDecoder<{ title: string; content: MaterialContentInput }>
    > & { context: ContextPreparation } = {
      quiz: quizTitledAgent,
      flashcards: flashcardsTitledAgent
    }[request.kind];
    const generated = request.autoTitle
      ? yield* generateAgent(titledDefinition, { prompt }, options).pipe(
          Effect.map(({ output, evidence }) => ({ ...output, evidence }))
        )
      : yield* generateAgent(definition, { prompt }, options).pipe(
          Effect.map(({ output, evidence }) => ({ content: output, title: undefined, evidence }))
        );
    const { content } = generated;

    yield* Effect.try({
      try: () => {
        assertQuestionSpec(request.questionSpec, content);
        assertQuizConfig(request.quizConfig, content);

        if (
          (content.kind === 'flashcards' && content.cards.length > 50) ||
          (content.kind === 'quiz' && content.questions.length > 10)
        )
          throw new StudyError('invalid_input', 'Generated content exceeds limits');
      },
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('invalid_input', 'Invalid quiz specification', { cause })
    });
    const safeContent =
      content.kind === 'flashcards'
        ? {
            kind: 'flashcards' as const,
            cards: content.cards.map(({ front, back }) => ({ front, back }))
          }
        : content;
    const text = JSON.stringify(safeContent);

    if (text.length > 100_000)
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Generated content exceeds limits')
      );

    const citations = yield* generated.evidence.citations(text).pipe(
      Effect.map((values) =>
        values.map(({ marker, reference, ...rest }) => ({
          ...rest,
          marker: BigInt(marker),
          input: reference
        }))
      )
    );

    if (!citations.length)
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Generated content must cite captured evidence')
      );

    return {
      requestId: request.id,
      generationEventId,
      title: generated.title,
      content: safeContent,
      citations
    };
  })
});

/** Compose reusable stages while each child owns its durable retries. */
export const materialGenerationProcedure = defineProcedure({
  id: 'material-generation-v1',
  purpose: 'material',
  input: materialGenerationProcedureInputSchema,
  output: materialGenerationPublicationSchema,
  execute: Effect.fnUntraced(function* (input: typeof materialGenerationProcedureInputSchema.Type) {
    const { request } = input;
    const materials = yield* Materials;
    const preflight = yield* generationPreflight(input);

    yield* preflight;
    const prompt = `Title: ${request.title}\nStudent instruction (data): ${request.instruction ?? ''}${request.questionSpec ? `\nProduce exactly one ${request.questionSpec.kind === 'choice' ? 'choice (single_choice or multiple_choice)' : 'open'} question.` : ''}${quizRequirements(request.quizConfig)}`;
    const snapshot = yield* runProcedure(
      materialHistoryProcedure,
      { requestId: request.id },
      { key: 'history', preflight }
    );
    const readHistory = () =>
      materials.materialGenerationHistory({ requestId: request.id, snapshot });
    const plan = yield* runProcedure(
      materialPlanProcedure,
      { ...input, prompt, history: snapshot },
      { key: 'plan', preflight }
    );
    let feedback = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      yield* preflight;
      const history = yield* readHistory();
      const candidate = yield* runProcedure(
        materialCandidateProcedure,
        {
          ...input,
          prompt,
          plan,
          history: snapshot,
          feedback,
          scope: `material-candidate-v1-${attempt}`
        },
        { key: `candidate-${attempt}`, preflight }
      );
      const exact = duplicateMaterialItems(candidate.content, history.items);
      const review = yield* runProcedure(
        materialNoveltyProcedure,
        {
          ...input,
          history: snapshot,
          candidate: candidate.content
        },
        { key: `novelty-${attempt}`, preflight }
      );
      const count =
        candidate.content.kind === 'quiz'
          ? candidate.content.questions.length
          : candidate.content.cards.length;

      if (review.duplicates.some(({ index }) => index >= count))
        return yield* Effect.fail(
          new StudyError('invalid_input', 'Novelty review refers to an unavailable item')
        );

      if (!exact.length && !review.duplicates.length) return candidate;

      // A repair is a new candidate, never a second request or an unbounded agent loop.
      feedback = materialRepairFeedback(candidate.content, exact, review);
    }

    return yield* Effect.fail(
      new StudyError('not_enough', 'Unable to generate sufficiently distinct learning material')
    );
  })
});

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
