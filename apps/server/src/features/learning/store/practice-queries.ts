/** @file Owns practice queries within this feature. */

import type { ErrorKind, ProjectId } from '@study/contracts';
import { contentInputSchema } from '@study/contracts';
import { and, eq, inArray } from '@study/db';
import { invalid } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makePracticeFailures } from './practice-failures.ts';
import type { Slot } from './practice-schemas.ts';
import { controls, slots } from './practice-schemas.ts';

export function makePracticeQueries(resources: StoreResources) {
  const { db } = resources;
  const { failureKind } = makePracticeFailures(resources);
  const view = (row: Slot, failure: ErrorKind | null = row.failure_kind) => ({
    slotId: row.id,
    projectId: row.project_id,
    epoch: row.epoch,
    ordinal: row.ordinal,
    kind: row.kind,
    status: row.status === 'pending' && failure ? ('failed' as const) : row.status,
    generationAttempt: row.generation_attempt,
    failureKind: row.status === 'pending' ? failure : null,
    inputs: Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.toCodecJson(Schema.mutable(Schema.Array(contentInputSchema))))
    )(row.inputs),
    versionId: row.version_id,
    attemptId: row.attempt_id
  });

  const control = (projectId: ProjectId) =>
    db.orm.select().from(controls).where(eq(controls.project_id, projectId)).get();

  function practice(projectId: ProjectId) {
    const current = control(projectId);

    const rows = current
      ? db.orm
          .select()
          .from(slots)
          .where(
            and(
              eq(slots.project_id, projectId),
              eq(slots.epoch, current.epoch),
              inArray(slots.status, ['pending', 'ready'])
            )
          )
          .orderBy(slots.ordinal)
          .limit(2)
          .all()
      : [];

    return {
      projectId,
      enabled: current?.enabled ?? false,
      epoch: current?.epoch ?? null,
      slots: rows.map((row) => view(row, failureKind(row)))
    };
  }

  function activeSlot(id: string) {
    const row = db.orm.select().from(slots).where(eq(slots.id, id)).get();

    if (!row) return null;

    const current = control(row.project_id);

    return current?.enabled && current.epoch === row.epoch && row.status === 'pending'
      ? view(row, failureKind(row))
      : null;
  }

  function answerSlot(id: string) {
    const row = db.orm.select().from(slots).where(eq(slots.id, id)).get();

    if (!row || row.attempt_id === null || row.version_id === null)
      invalid('practice slot is not ready');

    const current = control(row.project_id);

    if (
      row.status !== 'answered' &&
      (!current?.enabled || current.epoch !== row.epoch || row.status !== 'ready')
    )
      invalid('practice slot is inactive');

    return row;
  }

  return { control, view, activeSlot, practice, answerSlot };
}
