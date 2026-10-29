import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import { newMemory } from '#server/shared/study/srs';
import type { Memory } from '#server/shared/study/srs';

import { published } from './quiz.ts';

export function cardSnapshot(store: ServerContext, versionId: bigint, cardId: bigint) {
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
export function cardMemory(store: ServerContext, cardId: bigint, at: bigint): Memory {
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
