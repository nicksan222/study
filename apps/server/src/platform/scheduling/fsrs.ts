import { StudyError } from '@study/contracts/errors';
import type { learningRatingSchema } from '@study/contracts/learning/schemas';
import { createEmptyCard, fsrs, Rating as FsrsRating } from 'ts-fsrs';
import type { Card as FsrsCard, State } from 'ts-fsrs';

export type Rating = typeof learningRatingSchema.Type;

export type MemoryState = 0 | 1 | 2 | 3;

export type Memory = ReturnType<typeof fromCard>;

const scheduler = fsrs({
  enable_fuzz: false,
  learning_steps: ['10m'],
  relearning_steps: ['10m']
});

const grade = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy
} as const;

function asDate(seconds: bigint): Date {
  const date = new Date(Number(seconds) * 1000);

  if (!Number.isFinite(date.getTime()))
    throw new StudyError('invalid_input', 'invalid review time');

  return date;
}

function fromCard(card: FsrsCard) {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ? BigInt(Math.floor(card.last_review.getTime() / 1000)) : null,
    due: BigInt(Math.floor(card.due.getTime() / 1000)),
    state: card.state as MemoryState,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps
  };
}

function toCard(memory: Memory): FsrsCard {
  return {
    stability: memory.stability,
    difficulty: memory.difficulty,
    reps: memory.reps,
    lapses: memory.lapses,
    last_review: memory.lastReview === null ? undefined : asDate(memory.lastReview),
    due: asDate(memory.due),
    state: memory.state as State,
    elapsed_days: memory.elapsedDays,
    scheduled_days: memory.scheduledDays,
    learning_steps: memory.learningSteps
  };
}

export function newMemory(now: bigint): Memory {
  return fromCard(createEmptyCard(asDate(now)));
}

export function reviewMemory(memory: Memory, rating: Rating, now: bigint): Memory {
  const selected = grade[rating];

  if (!Object.hasOwn(grade, rating) || selected === undefined)
    throw new StudyError('invalid_input', 'invalid review rating');

  return fromCard(scheduler.next(toCard(memory), asDate(now), selected).card);
}
