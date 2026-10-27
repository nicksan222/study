import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import { newMemory } from '#backend/shared/study/srs';
import type { Memory } from '#backend/shared/study/srs';

import { published } from './quiz.ts';

export function cardSnapshot(store: BackendContext, versionId: bigint, cardId: bigint) {
  published(store, versionId, 'flashcards');
  const entry = store.db.orm
    .select()
    .from(s.material_flashcard_entries)
    .where(
      and(
        eq(s.material_flashcard_entries.version_id, versionId),
        eq(s.material_flashcard_entries.card_id, cardId)
      )
    )
    .get();

  if (!entry) throw new StudyError('not_found', 'card snapshot missing');

  return entry;
}

const states = { new: 0, learning: 1, review: 2, relearning: 3 } as const;

/** Scheduling belongs to stable card identity, independently of its versioned content. */
export function cardMemory(store: BackendContext, cardId: bigint, at: bigint): Memory {
  const schedule = store.db.orm
    .select()
    .from(s.material_card_schedules)
    .where(eq(s.material_card_schedules.card_id, cardId))
    .get();

  if (!schedule) return newMemory(at);

  return {
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    reps: Number(schedule.reps),
    lapses: Number(schedule.lapses),
    due: schedule.due,
    state: states[schedule.state],
    lastReview: schedule.last_review,
    elapsedDays: Number(schedule.elapsed_days),
    scheduledDays: Number(schedule.scheduled_days),
    learningSteps: Number(schedule.learning_steps)
  };
}

export type CardSnapshot = ReturnType<typeof cardSnapshot>;
