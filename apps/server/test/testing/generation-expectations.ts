import type {
  materialGenerationHistorySchema,
  materialNoveltyReviewSchema,
  MaterialVersionDetailDto,
  MaterialContentInput
} from '@study/contracts';
import { materialContentInputSchema } from '@study/contracts';
import type { createAiMock } from '@study/testing';
import { Schema } from 'effect';

import type { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { generationPlanAgent } from '#server/features/materials/agents/generation-plan';
import { noveltyReviewAgent } from '#server/features/materials/agents/novelty-review';
import type { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import {
  materialGenerationPrompt,
  duplicateMaterialItems,
  materialRepairFeedback,
  materialNoveltyItems
} from '#server/features/materials/decoders/generation-novelty';

type History = typeof materialGenerationHistorySchema.Type;

type MaterialAgent = typeof flashcardsAgent | typeof quizTitledAgent;

type AiMock = ReturnType<typeof createAiMock>;

function generationContent(output: MaterialAgent['output']['Type']): MaterialContentInput {
  return Schema.decodeUnknownSync(materialContentInputSchema)(
    'content' in output ? output.content : output
  );
}

export const generationTestPlan = { focus: ['Explore fresh supported learning concepts'] };

export const emptyGenerationHistory: History = { items: [], limited: false };

export function generationTestHistory(...versions: MaterialVersionDetailDto[]): History {
  return {
    items: versions.flatMap((version) =>
      materialNoveltyItems(version.content).map((item) => ({ ...item, versionId: version.id }))
    ),
    limited: false
  };
}

function expectPlan(ai: AiMock, target: MaterialAgent, task: string, history: History) {
  ai.next(generationPlanAgent, {
    input: { kind: target.id === 'quiz-titled' ? 'quiz' : 'flashcards', request: task, history },
    output: generationTestPlan
  });

  return { prompt: materialGenerationPrompt(task, generationTestPlan, history) };
}

/** Each expectation names a real stage; cancellation does not leave an expected review behind. */
export function expectMaterialGeneration<A extends MaterialAgent>(
  ai: AiMock,
  target: A,
  options: { input: { prompt: string }; output: A['output']['Type']; hold?: boolean },
  history: History = emptyGenerationHistory
) {
  const input = expectPlan(ai, target, options.input.prompt, history);
  const expected = ai.next(target, { ...options, input });
  const review = () =>
    ai.next(noveltyReviewAgent, {
      input: {
        history,
        candidate: 'content' in options.output ? options.output.content : options.output
      },
      output: { duplicates: [] }
    });

  if (!options.hold) review();

  return {
    ...expected,
    release(complete = true) {
      if (options.hold && complete) review();

      expected.release();
    }
  };
}

export function failMaterialGeneration(
  ai: AiMock,
  target: MaterialAgent,
  options: { input: { prompt: string }; error: Error },
  history: History = emptyGenerationHistory
) {
  return ai.failNext(target, {
    ...options,
    input: expectPlan(ai, target, options.input.prompt, history)
  });
}

/** Controlled peer replies for visible review/repair paths; all application services remain real. */
export function expectNoveltyGeneration<A extends MaterialAgent>(
  ai: AiMock,
  target: A,
  options: {
    input: { prompt: string };
    output: A['output']['Type'];
    review: typeof materialNoveltyReviewSchema.Type;
    repair?: A['output']['Type'];
    finalReview?: typeof materialNoveltyReviewSchema.Type;
  },
  history: History
) {
  const task = expectPlan(ai, target, options.input.prompt, history);

  ai.next(target, { input: task, output: options.output });
  const candidate = generationContent(options.output);
  const firstReview = ai.next(noveltyReviewAgent, {
    input: { history, candidate },
    output: options.review,
    hold: true
  });

  if (!options.repair) return { firstReview };

  const feedback = materialRepairFeedback(
    candidate,
    duplicateMaterialItems(candidate, history.items),
    options.review
  );
  const repair = ai.next(target, {
    input: {
      prompt: materialGenerationPrompt(options.input.prompt, generationTestPlan, history, feedback)
    },
    output: options.repair,
    hold: true
  });
  const repaired = generationContent(options.repair);
  const secondReview = ai.next(noveltyReviewAgent, {
    input: { history, candidate: repaired },
    output: options.finalReview ?? { duplicates: [] },
    hold: true
  });

  return { firstReview, repair, secondReview };
}
