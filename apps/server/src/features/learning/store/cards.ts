import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId, MaterialCardId } from '@study/contracts/ids';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import type { Memory } from '#server/platform/scheduling/fsrs';
import { newMemory } from '#server/platform/scheduling/fsrs';

import { makeQuiz } from './quiz.ts';

const states = {
  new: 0,
  learning: 1,
  review: 2,
  relearning: 3
} as const;

/** Scheduling belongs to stable card identity, independently of its versioned content. */
export function makeCards(resources: StoreResources) {
  const { db } = resources;
  const { published } = makeQuiz(resources);

  function cardSnapshot(versionId: MaterialVersionId, cardId: MaterialCardId) {
    published(versionId, 'flashcards');
    const entry = db.orm
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

  function cardMemory(cardId: MaterialCardId, at: bigint): Memory {
    const schedule = db.orm
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

  return {
    cardSnapshot,
    cardMemory
  };
}
