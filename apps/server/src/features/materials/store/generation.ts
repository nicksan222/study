import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import {
  materialGenerationInputSchema,
  materialGenerationPayloadSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
import { and, asc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { assertQuestionSpec } from '#server/features/materials/decoders/question-spec';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeCreateMaterial } from './create-material.ts';
import { makeReads, required } from './reads.ts';
import { anchorSchema } from './schemas.ts';
import { makeSetCitationsAction } from './set-citations-action.ts';
import { makeWrites, now } from './writes.ts';

const codec = Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema));

export function makeGeneration(resources: StoreResources) {
  const { db, clock } = resources;
  const { createMaterial } = makeCreateMaterial(resources);
  const { materialRow, versionRow } = makeReads(resources);
  const { setCitations } = makeSetCitationsAction(resources);
  const { publish, assertProject } = makeWrites(resources);

  function requestGenerationOnce(value: {
    requestId: string;
    request: typeof materialGenerationInputSchema.Type;
  }) {
    const request = Schema.decodeUnknownSync(materialGenerationInputSchema)(value.request);
    const existing = readGeneration(value.requestId);

    if (existing) {
      const payload = ({
        title,
        kind,
        instruction,
        inputVersionIds,
        scopeId,
        questionSpec
      }: typeof request) =>
        Schema.encodeSync(codec)({
          title,
          kind,
          instruction,
          inputVersionIds,
          scopeId,
          questionSpec
        });

      if (existing.projectId !== request.projectId || payload(existing) !== payload(request))
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

    assertProject(request.projectId);
    assertActiveScope(request);

    for (const id of request.inputVersionIds) {
      const version = versionRow(id);
      const material = materialRow(version.material_id);

      if (
        version.project_id !== request.projectId ||
        version.status !== 'published' ||
        version.kind !== 'document' ||
        material.archived_at !== null
      )
        throw new StudyError(
          'invalid_input',
          'Generation requires active published documents in the project'
        );

      required(
        db.orm
          .select()
          .from(s.material_document_versions)
          .where(eq(s.material_document_versions.version_id, id))
          .get()
      );
    }

    const { title, kind, instruction, scopeId, questionSpec } = request;

    db.orm
      .insert(s.material_generation_requests)
      .values({
        id: value.requestId,
        project_id: request.projectId,
        payload: Schema.encodeSync(codec)({
          title,
          kind,
          instruction,
          scopeId,
          questionSpec,
          inputVersionIds: request.inputVersionIds
        }),
        created_at: now(clock)
      })
      .run();
    db.orm
      .insert(s.material_generation_inputs)
      .values(
        request.inputVersionIds.map((id, position) => ({
          request_id: value.requestId,
          project_id: request.projectId,
          version_id: id,
          position: BigInt(position)
        }))
      )
      .run();

    return { id: value.requestId, ...request };
  }

  function readGeneration(requestId: string) {
    const row = db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, requestId))
      .get();

    if (!row) return null;

    const inputs = db.orm
      .select({
        versionId: s.material_generation_inputs.version_id,
        documentId: s.material_document_versions.document_id
      })
      .from(s.material_generation_inputs)
      .leftJoin(
        s.material_document_versions,
        eq(s.material_generation_inputs.version_id, s.material_document_versions.version_id)
      )
      .where(eq(s.material_generation_inputs.request_id, requestId))
      .orderBy(asc(s.material_generation_inputs.position))
      .all();

    if (inputs.some((input) => input.documentId === null))
      throw new StudyError('invalid_input', 'Generation inputs are incomplete');

    const payload = Schema.decodeUnknownSync(codec)(row.payload);

    if (
      payload.inputVersionIds.length !== inputs.length ||
      payload.inputVersionIds.some((id, index) => id !== inputs[index]?.versionId)
    )
      throw new StudyError('invalid_input', 'Generation inputs differ from captured intent');

    return {
      id: row.id,
      projectId: row.project_id,
      ...payload,
      inputVersionIds: inputs.map((input) => input.versionId),
      documentIds: inputs.map((input) => required(input.documentId)),
      resultVersionId: row.result_version_id
    };
  }

  function validateInputs(request: NonNullable<ReturnType<typeof readGeneration>>) {
    if (
      request.inputVersionIds.length === 0 ||
      request.inputVersionIds.length !== request.documentIds.length
    )
      throw new StudyError('invalid_input', 'Generation inputs are incomplete');

    for (const [index, id] of request.inputVersionIds.entries()) {
      const version = versionRow(id);
      const material = materialRow(version.material_id, true);
      const document = db.orm
        .select()
        .from(s.material_document_versions)
        .where(eq(s.material_document_versions.version_id, id))
        .get();

      if (
        version.project_id !== request.projectId ||
        material.project_id !== request.projectId ||
        version.kind !== 'document' ||
        version.status !== 'published' ||
        !document ||
        document.document_id !== request.documentIds[index]
      )
        throw new StudyError(
          'invalid_input',
          'Generation requires active published documents in the project'
        );
    }
  }

  function generationContext(requestId: string, eventId?: string, verifyOnly = false) {
    const request = readGeneration(requestId);

    if (request && eventId !== undefined) assertGenerationEvent(request, eventId);

    if (request && request.resultVersionId === null && !verifyOnly) {
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

  function publishGeneration(input: typeof materialGenerationPublicationSchema.Type) {
    const value = Schema.decodeUnknownSync(materialGenerationPublicationSchema)(input);
    const citations = [...value.citations].sort((a, b) =>
      a.marker < b.marker ? -1 : a.marker > b.marker ? 1 : 0
    );
    const hash = createHash('sha256')
      .update(
        Schema.encodeSync(publicationCodec)({
          requestId: value.requestId,
          content: value.content,
          citations
        })
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

    assertActiveScope(request);
    validateInputs(request);
    assertQuestionSpec(request.questionSpec, value.content);

    if (value.content.kind !== request.kind)
      throw new StudyError('invalid_input', 'Generation kind mismatch');

    if (new Set(citations.map((c) => c.marker)).size !== citations.length)
      throw new StudyError('invalid_input', 'Duplicate citation markers');

    const resolved = citations.map((citation) => {
      const index = request.inputVersionIds.indexOf(citation.inputVersionId);

      if (index < 0 || !citation.quote.trim())
        throw new StudyError('invalid_input', 'Invalid citation');

      const block = db.orm
        .select()
        .from(s.blocks)
        .where(
          and(
            eq(s.blocks.document_id, request.documentIds[index]!),
            eq(s.blocks.ordinal, BigInt(citation.blockOrdinal))
          )
        )
        .get();

      if (!block || !block.text.includes(citation.quote))
        throw new StudyError('invalid_input', 'Citation does not match its source block');

      return {
        marker: citation.marker,
        inputVersionId: citation.inputVersionId,
        anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(block.anchor)),
        quote: citation.quote
      };
    });
    const event = assertGenerationEvent(request, value.generationEventId ?? request.id);

    const material = createMaterial({
      projectId: request.projectId,
      title: request.title,
      content: value.content,
      inputs: request.inputVersionIds,
      operation: 'generate',
      language: value.language,
      publish: false
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
    db.orm
      .update(s.material_generation_requests)
      .set({ result_version_id: material.version.id, result_hash: hash })
      .where(eq(s.material_generation_requests.id, request.id))
      .run();

    return { versionId: material.version.id, event, materialId: material.id };
  }

  type Scope = {
    scopeId: string;
    projectId: (typeof materialGenerationInputSchema.Type)['projectId'];
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
    projectId: Scope['projectId'];
  }) {
    if (request.scopeId === undefined) return;

    const scope = db.orm
      .select()
      .from(s.material_generation_scopes)
      .where(eq(s.material_generation_scopes.id, request.scopeId))
      .get();

    if (!scope || scope.project_id !== request.projectId || !scope.enabled)
      throw new StudyError('invalid_input', 'Generation scope is not active for this project');
  }

  return {
    generationContext,
    prepareGenerationRetry,
    prepareGenerationFailure,
    publishGeneration,
    requestGeneration,
    requestGenerationOnce,
    setGenerationScope
  };
}
