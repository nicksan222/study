/** @file Owns practice schemas within this feature. */

import { failureSchema, projectIdSchema } from '@study/contracts';
import * as s from '@study/db';
import { Schema } from 'effect';
import { Workflow } from 'effect/workflow';

export const controls = s.learning_practice_controls;

export const slots = s.learning_practice_slots;

export type Slot = typeof slots.$inferSelect;

export const generationEventId = (row: Slot) =>
  row.generation_attempt === 0n ? row.id : `${row.id}/retry/${row.generation_attempt}`;

export const resultCodec = Schema.toCodecJson(
  Workflow.Result({ success: Schema.Unknown, error: failureSchema })
);

export const controlSchema = Schema.Struct({
  projectId: projectIdSchema,
  epoch: Schema.String,
  enabled: Schema.Boolean
});

export const practiceSlotLookupSchema = Schema.Struct({ slotId: Schema.String });
