/** @file Owns generation events within this feature. */

import { StudyError } from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';
import { decodeEvent } from '@study/server';
import type { StoreResources } from '@study/server';

import { makeGenerationQueries } from './generation-queries.ts';

export function makeGenerationEvents(resources: StoreResources) {
  const { db } = resources;

  const { readGeneration } = makeGenerationQueries(resources);

  function generationEventRow(eventId: string) {
    const row = db.orm
      .select()
      .from(s.workflowEvents)
      .where(eq(s.workflowEvents.eventId, eventId))
      .get();

    if (!row) throw new StudyError('invalid_input', 'Generation event is unavailable');

    return row;
  }

  function assertGenerationEvent(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    eventId: string
  ) {
    const row = generationEventRow(eventId);

    const event = decodeEvent(row.payload);

    if (
      event.type !== 'MaterialGenerationRequested' ||
      event.eventId !== eventId ||
      event.requestId !== request.id ||
      event.projectId !== request.projectId ||
      event.kind !== request.kind ||
      event.causationId !== null ||
      event.correlationId !== request.id ||
      event.inputVersion !== 1 ||
      event.depth !== 0
    )
      throw new StudyError('invalid_input', 'Invalid generation event');

    return event;
  }

  return { assertGenerationEvent };
}
