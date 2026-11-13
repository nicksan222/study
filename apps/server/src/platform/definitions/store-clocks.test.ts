/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies fixed presentation timestamps preserve advancing learning scheduling.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises future card eligibility while persisted note timestamps stay fixed.          │
 * │ - Checks default clock identity across nested SQLite transactions.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real stores and SQLite with separate Effect test clocks; no app runtime is started. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { assert, expect } from 'vite-plus/test';

import { CardStore } from '#server/features/learning/store/index';
import { MaterialsStore } from '#server/features/materials/store/index';
import { NoteStore } from '#server/features/notes/store/index';
import { ProjectsStore } from '#server/features/projects/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

function checkAdvancingEligibility(context: ServerContext) {
  return Effect.gen(function* () {
    const project = yield* transaction((tx) =>
      tx.store(ProjectsStore).createProject({ name: 'Live scheduling' })
    );
    const note = yield* transaction((tx) =>
      tx.store(NoteStore).createNote({ title: 'Fixed timestamp', titleSource: 'user' })
    );
    const material = yield* transaction((tx) =>
      tx.store(MaterialsStore).create({
        projectId: project.id,
        title: 'Live card',
        content: { kind: 'flashcards', cards: [{ front: 'Question', back: 'Answer' }] }
      })
    );
    const cards = yield* useStore(CardStore);
    const query = { projectId: project.id, limit: 10, newCardsPerDay: 10 };
    const initial = yield* cards.cards(query);

    assert.strictEqual(initial.length, 1);
    const cardId = initial[0]!.snapshot.card_id;
    const reviewInput = { versionId: material.version.id, cardId, rating: 'good' as const };
    const first = yield* transaction((tx) => tx.store(CardStore).reviewCard(reviewInput));
    const due = first.schedule.due;

    expect(note.createdAt).toBe(100n);
    expect(project.createdAt).toBe(100n);
    expect(material.created_at).toBe(100n);
    expect(first.review.reviewed_at).toBe(unixSeconds(context.clock));
    assert.ok(due > unixSeconds(context.clock));
    expect(yield* cards.cards(query)).toHaveLength(0);
    yield* TestClock.setTime(Number(due * 1000n - 1000n));
    expect(yield* cards.cards(query)).toHaveLength(0);
    yield* TestClock.adjust('1 second');
    const eligible = yield* cards.cards(query);

    expect(eligible.map((card) => card.snapshot.card_id)).toEqual([cardId]);
    const second = yield* transaction((tx) => tx.store(CardStore).reviewCard(reviewInput));
    const renamed = yield* transaction((tx) =>
      tx.store(NoteStore).renameNote({ id: note.id, title: 'Still fixed' })
    );

    expect(second.review.reviewed_at).toBe(due);
    expect(second.schedule.last_review).toBe(due);
    expect(second.schedule.due).toBeGreaterThan(due);
    expect(renamed.createdAt).toBe(100n);
    expect(renamed.updatedAt).toBe(100n);
    expect(unixSeconds(context.timestampClock)).toBe(100n);
  }).pipe(Effect.provideService(Database, { store: context }));
}

testStable(
  'future cards become due as operational time advances with fixed note timestamps',
  async () => {
    const timestampClock = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(100_000);

        return yield* Clock.Clock;
      }).pipe(Effect.provide(TestClock.layer()))
    );
    const location = await createTestDatabase();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(1_800_000_000_000);
          const clock = yield* Clock.Clock;
          const context = new ServerContext(
            yield* Effect.promise(() => location.open()),
            clock,
            timestampClock
          );

          assert.notStrictEqual(context.clock, context.timestampClock);
          yield* checkAdvancingEligibility(context).pipe(
            Effect.ensuring(Effect.sync(() => context.close()))
          );
        }).pipe(Effect.provide(TestClock.layer()))
      );
    } finally {
      await location.cleanup();
    }
  }
);

testStable(
  'default store contexts preserve clock identity through nested transactions',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());

    try {
      expect(context.timestampClock).toBe(context.clock);
      context.transaction((outer) => {
        expect(outer.timestampClock).toBe(context.clock);
        outer.transaction((inner) => {
          expect(inner.clock).toBe(context.clock);
          expect(inner.timestampClock).toBe(context.clock);
        });
      });
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
