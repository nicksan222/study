import type { quizAnswerSchema } from '@study/contracts/learning/schemas';
import {
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import { landingCopy } from '@study/localization/landing';
import { Schema } from 'effect';

type Lang = 'en' | 'it';

type Copy = (typeof landingCopy)[Lang];

type Answer = typeof quizAnswerSchema.Type;

type Attempt = typeof quizAttemptInProgressSchema.Type;

type Question = Attempt['questions'][number];

type Kind = (typeof kinds)[number];

export const kinds = [
  'single_choice',
  'multiple_choice',
  'open',
  'true_false',
  'fill_blank',
  'matching',
  'ordering'
] as const;

const termIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

const definitionIds = [
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004'
];

export function sample(lang: Lang, kind: (typeof kinds)[number]) {
  const c = landingCopy[lang];
  const question = sampleQuestion(c, kind);

  return Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    id: 1n,
    versionId: 1n,
    materialId: 1n,
    startedAt: 0n,
    status: 'in_progress',
    questions: [{ id: 1n, position: 0n, kind, answer: null, ...question }]
  });
}

function choices(texts: readonly string[]) {
  return texts.map((text, index) => ({ id: BigInt(index + 1), position: BigInt(index), text }));
}

function sampleQuestion(c: Copy, kind: Kind) {
  switch (kind) {
    case 'matching':
      return {
        prompt: c.quizExample.matchPrompt,
        terms: c.quizExample.matchParts.map((text, index) => ({ id: termIds[index], text })),
        definitions: c.quizExample.matchRoles.map((text, index) => ({
          id: definitionIds[index],
          text
        }))
      };
    case 'ordering':
      return {
        prompt: c.quizExample.orderPrompt,
        items: [2, 0, 1].map((index) => ({
          id: BigInt(index + 1),
          text: c.quizExample.orderItems[index]
        }))
      };
    case 'open':
      return { prompt: c.quizExample.writtenPrompt };
    case 'fill_blank':
      return { prompt: c.quizExample.blankPrompt };
    case 'true_false':
      return { prompt: c.quizExample.booleanPrompt, choices: choices(['true', 'false']) };
    case 'multiple_choice':
      return { prompt: c.quizExample.multiplePrompt, choices: choices(c.examples.quizChoices) };
    case 'single_choice':
      return { prompt: c.examples.quizPrompt, choices: choices(c.examples.quizChoices) };
  }
}

// These callbacks compare authored sample keys; written responses never invoke model grading.
function sampleScore(answer: Answer, kind: Kind) {
  switch (answer.type) {
    case 'open':
      return null;
    case 'choice': {
      const correct = kind === 'multiple_choice' ? [1n, 2n] : [2n];

      return Number(
        answer.choiceIds.length === correct.length &&
          answer.choiceIds.every((id) => correct.includes(id))
      );
    }
    case 'ordering':
      return Number(answer.itemIds.every((id, index) => id === BigInt(index + 1)));
    case 'matching':
      return (
        answer.associations.filter(
          (pair) => definitionIds[termIds.indexOf(pair.termId)] === pair.definitionId
        ).length / termIds.length
      );
  }
}

function resultDetails(question: Question, answer: Answer, c: Copy) {
  if ('choices' in question)
    return {
      choices: question.choices.map((choice, index) => ({
        ...choice,
        isCorrect: question.kind === 'multiple_choice' ? index !== 2 : index === 1
      }))
    };

  switch (question.kind) {
    case 'open':
      return { referenceAnswer: c.quizExample.sampleAnswer };
    case 'fill_blank':
      return { referenceAnswer: c.quizExample.blankReference };
    case 'ordering':
      return { correctItemIds: [1n, 2n, 3n] };
    case 'matching':
      return {
        pairs: termIds.map((termId, index) => ({
          termId,
          definitionId: definitionIds[index],
          score: matchingScore(answer, termId, index)
        }))
      };
  }
}

function matchingScore(answer: Answer, termId: string, index: number) {
  if (answer.type !== 'matching') return 0;

  return Number(
    answer.associations.some(
      (pair) => pair.termId === termId && pair.definitionId === definitionIds[index]
    )
  );
}

export function sampleResult(attempt: Attempt, answer: Answer, c: Copy) {
  const question = attempt.questions[0]!;
  const score = sampleScore(answer, question.kind);

  return Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
    ...attempt,
    status: 'completed',
    finishedAt: 1n,
    questions: [
      {
        ...question,
        answer,
        score,
        feedback: null,
        grading: score === null ? 'ungraded' : 'graded',
        explanation:
          question.kind === 'ordering' ? c.quizExample.correctSequence : c.quizExample.sampleAnswer,
        ...resultDetails(question, answer, c)
      }
    ],
    scoring: {
      complete: score !== null,
      gradedCount: Number(score !== null),
      questionCount: 1,
      earned: score ?? 0,
      score
    }
  });
}
