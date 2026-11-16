/** @file Owns generation requests within this feature. */

import type { ErrorKind } from '@study/contracts';
import { StudyError, materialGenerationInputSchema } from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';
import { decodeEvent } from '@study/server';
import type { StoreResources } from '@study/server';
import { CryptoHasher } from 'bun';
import { Schema } from 'effect';

import { makeGenerationEvents } from './generation-events.ts';
import { makeGenerationQueries } from './generation-queries.ts';
import { codec } from './generation-schemas.ts';
import { makeGenerationScope } from './generation-scope.ts';
import { makeGenerationValidation } from './generation-validation.ts';
import { required } from './reads.ts';
import { now } from './writes.ts';

export function makeGenerationRequests(resources: StoreResources) {
  const { db, clock } = resources;

  const { readGeneration, exact } = makeGenerationQueries(resources);
  const { assertActiveScope } = makeGenerationScope(resources);
  const { assertGenerationEvent } = makeGenerationEvents(resources);
  const { assertNotCancelled, validateInputs } = makeGenerationValidation(resources);

  function requestGenerationOnce(value: {
    requestId: string;
    request: typeof materialGenerationInputSchema.Type;
  }) {
    const request = Schema.decodeUnknownSync(materialGenerationInputSchema)(value.request);

    const existing = readGeneration(value.requestId);

    if (existing) {
      const same = Schema.toEquivalence(materialGenerationInputSchema);

      const canonical = (input: typeof request) => ({
        projectId: input.projectId,
        title: input.title,
        autoTitle: input.autoTitle,
        kind: input.kind,
        instruction: input.instruction,
        inputs: input.inputs,
        scopeId: input.scopeId,
        questionSpec: input.questionSpec,
        quizConfig: input.quizConfig
      });

      if (!same(canonical(existing), canonical(request)))
        throw new StudyError('invalid_input', 'Generation request key has different intent');

      return { request: { id: existing.id, ...request }, created: false };
    }

    return {
      request: requestGeneration({ requestId: value.requestId, request }),
      created: true
    };
  }

  function requestGeneration(value: {
    requestId: string;
    request: typeof materialGenerationInputSchema.Type;
  }) {
    const request = Schema.decodeUnknownSync(materialGenerationInputSchema)(value.request);

    assertActiveScope(request);

    const { title, autoTitle, kind, instruction, scopeId, questionSpec, quizConfig } = request;

    db.orm
      .insert(s.material_generation_requests)
      .values({
        id: value.requestId,
        project_id: request.projectId ?? null,
        payload: Schema.encodeSync(codec)({
          title,
          autoTitle,
          kind,
          instruction,
          scopeId,
          questionSpec,
          quizConfig,
          inputs: request.inputs
        }),
        created_at: now(clock)
      })
      .run();

    exact.insertInputs({ kind: 'request', id: value.requestId }, request.inputs);

    return { id: value.requestId, ...request };
  }

  function generationContext(requestId: string, eventId?: string, verifyOnly = false) {
    const request = readGeneration(requestId);

    if (request && eventId !== undefined) assertGenerationEvent(request, eventId);

    if (request && request.resultVersionId === null && !verifyOnly) {
      assertNotCancelled(request);

      assertActiveScope(request);

      validateInputs(request);
    }

    return request;
  }

  function prepareGenerationRetry(value: { requestId: string; retryId: string }) {
    const request = required(readGeneration(value.requestId));

    if (request.resultVersionId === null) assertNotCancelled(request);

    const existing = db.orm
      .select()
      .from(s.workflowEvents)
      .where(eq(s.workflowEvents.eventId, value.retryId))
      .get();

    if (existing) {
      assertGenerationEvent(request, value.retryId);

      if (value.retryId === value.requestId)
        throw new StudyError('invalid_input', 'Retry key is the original request');

      return { request, created: false };
    }

    if (request.resultVersionId !== null) return { request, created: false };

    assertNotCancelled(request);

    assertActiveScope(request);

    validateInputs(request);

    return { request, created: true };
  }

  function prepareGenerationFailure(value: {
    requestId: string;
    generationEventId: string;
    errorKind: ErrorKind;
  }) {
    const request = required(readGeneration(value.requestId));

    const event = assertGenerationEvent(request, value.generationEventId);

    const failureId = `material-generation-failed/${new CryptoHasher('sha256').update(value.generationEventId).digest('hex')}`;

    const row = db.orm
      .select()
      .from(s.workflowEvents)
      .where(eq(s.workflowEvents.eventId, failureId))
      .get();

    if (row) {
      const existing = decodeEvent(row.payload);

      if (
        existing.type !== 'MaterialGenerationFailed' ||
        existing.requestId !== request.id ||
        existing.generationEventId !== event.eventId ||
        existing.projectId !== request.projectId ||
        existing.kind !== request.kind ||
        existing.errorKind !== value.errorKind
      )
        throw new StudyError('invalid_input', 'Generation failure key has different intent');
    }

    return { request, event, failureId, created: !row && request.resultVersionId === null };
  }

  return {
    generationContext,
    prepareGenerationRetry,
    prepareGenerationFailure,
    requestGeneration,
    requestGenerationOnce
  };
}
