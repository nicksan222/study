/** @file Owns practice reservations within this feature. */

import type { ContentInput, ProjectId } from '@study/contracts';
import { contentInputKey, contentInputSchema } from '@study/contracts';
import * as s from '@study/db';
import { and, desc, eq, inArray } from '@study/db';
import { Schema } from 'effect';

import { contentInputColumns } from '#server/platform/database/content-input';
import { requireRow } from '#server/platform/database/rows';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { makePracticeQueries } from './practice-queries.ts';
import type { Slot } from './practice-schemas.ts';
import { controls, slots } from './practice-schemas.ts';

export function makePracticeReservations(resources: StoreResources) {
  const { db } = resources;
  const { control, view } = makePracticeQueries(resources);

  function reserve(
    projectId: ProjectId,
    epoch: string,
    ordinal: bigint,
    inputs: readonly ContentInput[]
  ) {
    const id = crypto.randomUUID();

    db.orm
      .insert(slots)
      .values({
        id,
        project_id: projectId,
        epoch,
        ordinal,
        kind: ordinal % 3n === 2n ? 'open' : 'choice',
        status: 'pending',
        inputs: Schema.encodeSync(
          Schema.fromJsonString(Schema.toCodecJson(Schema.Array(contentInputSchema)))
        )(inputs)
      })
      .run();

    for (const [position, input] of inputs.entries())
      db.orm
        .insert(s.learning_practice_inputs)
        .values({
          slot_id: id,
          position: BigInt(position),
          ...contentInputColumns(input)
        })
        .run();

    return id;
  }

  function start(projectId: ProjectId, inputs: readonly ContentInput[]) {
    const existing = control(projectId);

    if (existing?.enabled) return [];

    if (
      !inputs.length ||
      inputs.length > 20 ||
      new Set(inputs.map(contentInputKey)).size !== inputs.length
    )
      invalid('invalid practice inputs');

    const epoch = crypto.randomUUID();

    db.orm
      .insert(controls)
      .values({ project_id: projectId, epoch, enabled: true })
      .onConflictDoUpdate({ target: controls.project_id, set: { epoch, enabled: true } })
      .run();

    return [reserve(projectId, epoch, 0n, inputs), reserve(projectId, epoch, 1n, inputs)];
  }

  function stop(projectId: ProjectId, epoch: string) {
    db.orm
      .update(controls)
      .set({ enabled: false })
      .where(and(eq(controls.project_id, projectId), eq(controls.epoch, epoch)))
      .run();

    db.orm
      .update(slots)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(slots.project_id, projectId),
          eq(slots.epoch, epoch),
          inArray(slots.status, ['pending', 'ready'])
        )
      )
      .run();
    db.orm
      .delete(s.learning_practice_inputs)
      .where(
        inArray(
          s.learning_practice_inputs.slot_id,
          db.orm
            .select({ id: slots.id })
            .from(slots)
            .where(
              and(
                eq(slots.project_id, projectId),
                eq(slots.epoch, epoch),
                eq(slots.status, 'cancelled')
              )
            )
        )
      )
      .run();
  }

  function refill(row: Slot) {
    db.orm.update(slots).set({ status: 'answered' }).where(eq(slots.id, row.id)).run();
    db.orm
      .delete(s.learning_practice_inputs)
      .where(eq(s.learning_practice_inputs.slot_id, row.id))
      .run();

    const last = requireRow(
      db.orm
        .select()
        .from(slots)
        .where(and(eq(slots.project_id, row.project_id), eq(slots.epoch, row.epoch)))
        .orderBy(desc(slots.ordinal))
        .limit(1)
        .get()
    );

    return reserve(row.project_id, row.epoch, last.ordinal + 1n, view(row).inputs);
  }

  return { start, stop, refill };
}
