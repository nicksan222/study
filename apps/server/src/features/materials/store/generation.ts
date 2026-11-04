/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Stores generation requests, snapshots, and publication or failure state for        │
 * │ material workflows.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Fences request identity and publication status for durable generation handlers.        │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies                   │
 * │ policy and composes these private operations.                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { contentInputKey, resolvedContentInputSchema } from '@study/contracts/inputs';
import {
  materialGenerationInputSchema,
  materialGenerationPayloadSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
import { validBlockTextRange } from '@study/contracts/sources/document';
import { decodeBlockContent } from '@study/contracts/sources/document';
import { hasTextualContent } from '@study/contracts/sources/schemas';
import { and, asc, eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { canonicalJson } from '#server/features/materials/decoders/edit-intent';
import { assertQuestionSpec } from '#server/features/materials/decoders/question-spec';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeCreateMaterial } from './create-material.ts';
import { makeExactInputs } from './exact-inputs.ts';
import { makeReads, required } from './reads.ts';
import { makeSetCitationsAction } from './set-citations-action.ts';
import { makeWrites, now } from './writes.ts';

const codec = Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema));

export function makeGeneration(resources: StoreResources) {
  const { db, clock } = resources;
  const exact = makeExactInputs(resources);

  const { createMaterial } = makeCreateMaterial(resources);

  const { materialRow, versionRow, readVersion } = makeReads(resources);

  const { setCitations } = makeSetCitationsAction(resources);

  const { publish, insertVersion, assertProject, assertMembership } = makeWrites(resources);

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
        kind: input.kind,
        instruction: input.instruction,
        inputs: input.inputs,
        scopeId: input.scopeId,
        questionSpec: input.questionSpec
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

    const { title, kind, instruction, scopeId, questionSpec } = request;

    db.orm
      .insert(s.material_generation_requests)
      .values({
        id: value.requestId,
        project_id: request.projectId ?? null,
        payload: Schema.encodeSync(codec)({
          title,
          kind,
          instruction,
          scopeId,
          questionSpec,
          inputs: request.inputs
        }),
        created_at: now(clock)
      })
      .run();

    exact.insertInputs({ kind: 'request', id: value.requestId }, request.inputs);

    return { id: value.requestId, ...request };
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
      resultVersionId: row.result_version_id
    };
  }

  function validateInputs(request: NonNullable<ReturnType<typeof readGeneration>>) {
    if (!request.inputs.length)
      throw new StudyError('invalid_input', 'Generation input capture is unavailable');
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

    const failureId = `material-generation-failed/${createHash('sha256').update(value.generationEventId).digest('hex')}`;

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

  const publicationCodec = Schema.fromJsonString(
    Schema.toCodecJson(materialGenerationPublicationSchema)
  );

  function publishGeneration(
    input: typeof materialGenerationPublicationSchema.Type & {
      inputSnapshots: readonly (typeof resolvedContentInputSchema.Type)[];
    }
  ) {
    const value = Schema.decodeUnknownSync(materialGenerationPublicationSchema)(input);

    const citations = [...value.citations].sort((a, b) =>
      a.marker < b.marker ? -1 : a.marker > b.marker ? 1 : 0
    );

    const hash = createHash('sha256')
      .update(
        canonicalJson(
          Schema.encodeSync(publicationCodec)({
            requestId: value.requestId,
            content: value.content,
            language: value.language,
            citations
          })
        )
      )
      .digest('hex');

    const row = required(
      db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, value.requestId))
        .get()
    );

    if (row.result_version_id !== null) {
      if (row.result_hash !== hash)
        throw new StudyError('invalid_input', 'Generation result differs from committed result');

      return { versionId: row.result_version_id, event: null };
    }

    const request = required(readGeneration(value.requestId));

    assertNotCancelled(request);

    assertActiveScope(request);

    validateInputs(request);

    assertGenerationContent(request, value);

    const resolved = citations.map((citation) =>
      resolveGenerationCitation(request, citation, input.inputSnapshots)
    );

    const event = assertGenerationEvent(request, value.generationEventId ?? request.id);

    const result = createGenerationOutput(request, value, resolved);

    db.orm
      .update(s.material_generation_requests)
      .set({
        result_version_id: result.versionId,
        result_hash: hash
      })
      .where(eq(s.material_generation_requests.id, request.id))
      .run();

    return {
      ...result,
      event
    };
  }

  function createGenerationOutput(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    value: typeof materialGenerationPublicationSchema.Type,
    resolved: ReturnType<typeof resolveGenerationCitation>[]
  ) {
    const versionInput = {
      content: value.content,
      inputs: request.inputs,
      operation: 'generate' as const,
      language: value.language,
      publish: false
    };

    const material = createMaterial({
      ...versionInput,
      projectId: request.projectId,
      title: request.title
    });

    db.orm
      .update(s.material_versions)
      .set({
        creator: 'agent',
        instruction: request.instruction ?? null,
        generation_request_id: request.id
      })
      .where(eq(s.material_versions.id, material.version.id))
      .run();

    setCitations({ id: material.version.id, citations: resolved });

    publish(material.version.id);
    return { versionId: material.version.id, materialId: material.id };
  }

  function resolveGenerationCitation(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    citation: (typeof materialGenerationPublicationSchema.Type)['citations'][number],
    snapshots: readonly (typeof resolvedContentInputSchema.Type)[]
  ) {
    const key = contentInputKey(citation.input);
    const selected = snapshots.find((snapshot) => contentInputKey(snapshot.input) === key);
    if (!selected || !request.inputs.some((input) => contentInputKey(input) === key))
      throw new StudyError('invalid_input', 'Citation is outside exact learning inputs');
    const block = selected.document.blocks[citation.blockOrdinal];
    if (!block || !block.text.includes(citation.quote))
      throw new StudyError('invalid_input', 'Citation does not match its exact source block');
    if (
      citation.target &&
      (citation.target.blockId !== block.id ||
        !validBlockTextRange(selected.document, citation.target) ||
        !block.text.slice(citation.target.start, citation.target.end).includes(citation.quote))
    )
      throw new StudyError(
        'invalid_input',
        'Citation target does not match its exact source passage'
      );
    return {
      marker: citation.marker,
      input: citation.input,
      anchor: block.anchor,
      target: citation.target,
      quote: citation.quote
    };
  }

  function assertGenerationContent(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    value: typeof materialGenerationPublicationSchema.Type
  ) {
    assertQuestionSpec(request.questionSpec, value.content);

    if (value.content.kind !== request.kind)
      throw new StudyError('invalid_input', 'Generation kind mismatch');

    if (value.citations.length === 0)
      throw new StudyError('invalid_input', 'Generated content must cite captured evidence');

    if (new Set(value.citations.map((c) => c.marker)).size !== value.citations.length)
      throw new StudyError('invalid_input', 'Duplicate citation markers');
  }

  type Scope = {
    scopeId: string;
    projectId: NonNullable<(typeof materialGenerationInputSchema.Type)['projectId']>;
  };

  function setGenerationScope(value: Scope, enabled: boolean) {
    assertProject(value.projectId);

    const existing = db.orm
      .select()
      .from(s.material_generation_scopes)
      .where(eq(s.material_generation_scopes.id, value.scopeId))
      .get();

    if (existing && existing.project_id !== value.projectId)
      throw new StudyError('invalid_input', 'Generation scope belongs to another project');

    if (existing) {
      if (!enabled && existing.enabled)
        db.orm
          .update(s.material_generation_scopes)
          .set({ enabled: false, updated_at: now(clock) })
          .where(eq(s.material_generation_scopes.id, value.scopeId))
          .run();

      return;
    }

    db.orm
      .insert(s.material_generation_scopes)
      .values({
        id: value.scopeId,
        project_id: value.projectId,
        enabled,
        created_at: now(clock),
        updated_at: now(clock)
      })
      .run();
  }

  function assertActiveScope(request: {
    scopeId?: string | undefined;
    projectId?: Scope['projectId'];
    kind?: string;
  }) {
    if (request.kind === 'document') return;

    if (request.projectId === undefined)
      throw new StudyError('invalid_input', 'Collection generation requires a project');

    assertProject(request.projectId);

    if (request.scopeId === undefined) return;

    const scope = db.orm
      .select()
      .from(s.material_generation_scopes)
      .where(eq(s.material_generation_scopes.id, request.scopeId))
      .get();

    if (!scope || scope.project_id !== request.projectId || !scope.enabled)
      throw new StudyError('invalid_input', 'Generation scope is not active for this project');
  }

  function assertNotCancelled(request: { id: string; cancelled: boolean }) {
    if (request.cancelled) throw new StudyError('cancelled', 'Generation was cancelled');
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

  return {
    cancelGeneration,
    generationContext,
    prepareGenerationRetry,
    prepareGenerationFailure,
    publishGeneration,
    requestGeneration,
    requestGenerationOnce,
    setGenerationScope
  };
}
