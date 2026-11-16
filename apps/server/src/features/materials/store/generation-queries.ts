/** @file Owns generation queries within this feature. */

import type { ErrorKind, ProjectId } from '@study/contracts';
import { StudyError, contentInputKey } from '@study/contracts';
import * as s from '@study/db';
import { and, desc, eq, isNull, sql } from '@study/db';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeExactInputs } from './exact-inputs.ts';
import { codec } from './generation-schemas.ts';
import { required } from './reads.ts';

export function makeGenerationQueries(resources: StoreResources) {
  const { db } = resources;

  const exact = makeExactInputs(resources);

  function activeGenerations(value: { projectId?: ProjectId }) {
    return db.orm
      .select({ id: s.material_generation_requests.id })
      .from(s.material_generation_requests)
      .where(
        and(
          eq(s.material_generation_requests.cancelled, false),
          isNull(s.material_generation_requests.result_version_id),
          sql`${s.material_generation_requests.payload} != '{}'`,
          value.projectId
            ? eq(s.material_generation_requests.project_id, value.projectId)
            : undefined
        )
      )
      .orderBy(
        desc(s.material_generation_requests.created_at),
        desc(s.material_generation_requests.id)
      )
      .all()
      .filter(
        (row) =>
          !db.orm
            .select({ id: s.material_history_requests.request_id })
            .from(s.material_history_requests)
            .where(eq(s.material_history_requests.request_id, row.id))
            .get() &&
          !db.orm
            .select({ id: s.material_deletion_requests.request_id })
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.request_id, row.id))
            .get()
      )
      .map((row) => required(readGeneration(row.id)))
      .filter((request) => request.kind === 'quiz' || request.kind === 'flashcards');
  }

  function readGeneration(requestId: string) {
    if (
      db.orm
        .select()
        .from(s.material_history_requests)
        .where(eq(s.material_history_requests.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', 'Generation input history is unavailable');

    if (
      db.orm
        .select()
        .from(s.material_deletion_requests)
        .where(eq(s.material_deletion_requests.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', 'Material generation has been retired');

    const row = db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, requestId))
      .get();

    if (!row) return null;

    if (row.payload === '{}')
      throw new StudyError('not_found', 'Generation inputs are unavailable');

    const payload = Schema.decodeUnknownSync(codec)(row.payload);
    const inputs =
      row.cancelled && row.result_version_id === null
        ? payload.inputs
        : exact.inputs({ kind: 'request', id: requestId });

    if (
      payload.inputs.length !== inputs.length ||
      payload.inputs.some(
        (input, index) => contentInputKey(input) !== contentInputKey(inputs[index]!)
      )
    )
      throw new StudyError('invalid_input', 'Generation inputs differ from captured intent');

    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      cancelled: row.cancelled,
      ...payload,
      inputs,
      errorKind: generationError(requestId, row.result_version_id !== null, row.cancelled),
      resultVersionId: row.result_version_id
    };
  }

  function generationError(
    requestId: string,
    published: boolean,
    cancelled: boolean
  ): ErrorKind | null {
    if (published || cancelled) return null;

    const events = db.orm
      .select()
      .from(s.workflowEvents)
      .where(eq(s.workflowEvents.correlationId, requestId))
      .orderBy(desc(s.workflowEvents.createdAt), desc(s.workflowEvents.eventId))
      .all()
      .map((event) => decodeEvent(event.payload));
    const failures = events.filter((event) => event.type === 'MaterialGenerationFailed');
    const failedAttempts = new Set(failures.map((failure) => failure.generationEventId));
    const pending = events.some(
      (event) => event.type === 'MaterialGenerationRequested' && !failedAttempts.has(event.eventId)
    );

    return pending ? null : (failures[0]?.errorKind ?? null);
  }

  function cancelGeneration(value: { requestId: string }) {
    const request = required(readGeneration(value.requestId));

    if (request.resultVersionId === null) {
      db.orm
        .update(s.material_generation_requests)
        .set({ cancelled: true })
        .where(eq(s.material_generation_requests.id, value.requestId))
        .run();
      exact.releaseInputs({ kind: 'request', id: value.requestId });
    }

    return required(readGeneration(value.requestId));
  }

  return { readGeneration, exact, activeGenerations, cancelGeneration };
}
