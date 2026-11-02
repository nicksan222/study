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
import {
  documentTransformReportSchema,
  materialGenerationInputSchema,
  materialGenerationPayloadSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
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
import { makeProposalRegistration } from './document-proposals.ts';
import { makeReads, required } from './reads.ts';
import { anchorSchema } from './schemas.ts';
import { makeSetCitationsAction } from './set-citations-action.ts';
import { makeWrites, now } from './writes.ts';

const reportCodec = Schema.fromJsonString(Schema.toCodecJson(documentTransformReportSchema));

const codec = Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema));

export function makeGeneration(resources: StoreResources) {
  const { db, clock } = resources;

  const { createMaterial } = makeCreateMaterial(resources);

  const registerProposal = makeProposalRegistration(resources);

  const { materialRow, versionRow, versionDocumentId, readVersion } = makeReads(resources);

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
        documentTransform: input.documentTransform,
        instruction: input.instruction,
        inputVersionIds: input.inputVersionIds,
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

    if (
      request.documentTransform &&
      value.requestId !== `document/${request.documentTransform.contextRequestId}`
    )
      throw new StudyError(
        'invalid_input',
        'Document request must use its captured context identity'
      );

    assertActiveScope(request);

    assertRequestedInputVersions(request);

    const { title, kind, instruction, scopeId, questionSpec, documentTransform } = request;

    db.orm
      .insert(s.material_generation_requests)
      .values({
        id: value.requestId,
        project_id: request.projectId ?? null,
        payload: Schema.encodeSync(codec)({
          documentTransform,
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

    if (request.inputVersionIds.length)
      db.orm
        .insert(s.material_generation_inputs)
        .values(
          request.inputVersionIds.map((id, position) => ({
            request_id: value.requestId,
            version_id: id,
            position: BigInt(position)
          }))
        )
        .run();

    return { id: value.requestId, ...request };
  }

  function assertRequestedInputVersions(request: typeof materialGenerationInputSchema.Type) {
    for (const id of request.inputVersionIds) {
      const version = versionRow(id);

      const material = materialRow(version.material_id);

      if (request.projectId !== undefined) assertMembership(request.projectId, material.id);

      if (version.status !== 'published' || material.archived_at !== null)
        throw new StudyError(
          'invalid_input',
          'Generation requires active published documents in the project'
        );

      if (versionDocumentId(id) === null)
        throw new StudyError('invalid_input', 'Generation requires an extracted document revision');
    }

    for (const id of request.inputVersionIds) assertTextEvidence(required(versionDocumentId(id)));
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

    if (
      db.orm
        .select()
        .from(s.session_generation_retirements)
        .where(eq(s.session_generation_retirements.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', 'Session generation has been retired');

    const inputs = db.orm
      .select({
        versionId: s.material_generation_inputs.version_id,
        documentId: s.material_generation_inputs.version_id
      })
      .from(s.material_generation_inputs)
      .where(eq(s.material_generation_inputs.request_id, requestId))
      .orderBy(asc(s.material_generation_inputs.position))
      .all()
      .map((input) => ({ ...input, documentId: versionDocumentId(input.versionId) }));

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
      projectId: row.project_id ?? undefined,
      cancelled: row.cancelled,
      report:
        row.result_metadata === null
          ? null
          : Schema.decodeUnknownSync(reportCodec)(row.result_metadata),
      ...payload,
      inputVersionIds: inputs.map((input) => input.versionId),
      documentIds: inputs.map((input) => required(input.documentId)),
      resultVersionId: row.result_version_id
    };
  }

  function assertTextEvidence(documentId: NonNullable<ReturnType<typeof versionDocumentId>>) {
    const blocks = db.orm
      .select({ content: s.blocks.content })
      .from(s.blocks)
      .where(eq(s.blocks.document_id, documentId))
      .all();

    if (!blocks.some((block) => hasTextualContent(decodeBlockContent(block.content))))
      throw new StudyError('invalid_input', 'Generation requires captured textual evidence');
  }

  function validateInputs(request: NonNullable<ReturnType<typeof readGeneration>>) {
    if (
      (request.kind !== 'document' && request.inputVersionIds.length === 0) ||
      request.inputVersionIds.length !== request.documentIds.length
    )
      throw new StudyError('invalid_input', 'Generation inputs are incomplete');

    for (const [index, id] of request.inputVersionIds.entries()) {
      const version = versionRow(id);

      const material = materialRow(version.material_id, true);

      if (request.projectId !== undefined) assertMembership(request.projectId, material.id);

      const documentId = versionDocumentId(id);

      if (documentId !== null) assertTextEvidence(documentId);

      if (
        version.status !== 'published' ||
        documentId === null ||
        documentId !== request.documentIds[index]
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
    input: typeof materialGenerationPublicationSchema.Type & { proposalSessionId?: SessionId }
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
            report: value.report,
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

    const resolved = citations.map((citation) => resolveGenerationCitation(request, citation));

    const event = assertGenerationEvent(request, value.generationEventId ?? request.id);

    const result = createGenerationOutput(request, value, input.proposalSessionId, resolved);

    db.orm
      .update(s.material_generation_requests)
      .set({
        result_version_id: result.versionId,
        result_hash: hash,
        result_metadata:
          value.report === undefined ? null : Schema.encodeSync(reportCodec)(value.report)
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
    proposalSessionId: SessionId | undefined,
    resolved: ReturnType<typeof resolveGenerationCitation>[]
  ) {
    const targetVersionId = request.documentTransform?.editTargetVersionId;

    const target = targetVersionId === undefined ? undefined : versionRow(targetVersionId);

    const versionInput = {
      content: value.content,
      inputs: request.inputVersionIds,
      operation: 'generate' as const,
      language: value.language,
      publish: false
    };

    const material =
      target === undefined
        ? createMaterial({ ...versionInput, projectId: request.projectId, title: request.title })
        : {
            id: target.material_id,
            version: {
              id: insertVersion(target.material_id, { ...versionInput, parents: [target.id] })
            }
          };

    db.orm
      .update(s.material_versions)
      .set({
        creator: 'agent',
        instruction: request.documentTransform ? null : (request.instruction ?? null),
        generation_request_id: request.id
      })
      .where(eq(s.material_versions.id, material.version.id))
      .run();

    setCitations({ id: material.version.id, citations: resolved });

    if (target === undefined) publish(material.version.id);
    else
      registerProposal({
        requestId: request.id,
        sessionId: required(proposalSessionId),
        baseVersionId: target.id,
        proposedVersionId: material.version.id
      });

    return {
      versionId: material.version.id,
      ...(target === undefined ? { materialId: material.id } : {})
    };
  }

  function resolveGenerationCitation(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    citation: (typeof materialGenerationPublicationSchema.Type)['citations'][number]
  ) {
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
      ...(citation.target === undefined ? {} : { target: citation.target }),
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

    const targetVersionId = request.documentTransform?.editTargetVersionId;

    const target =
      targetVersionId === undefined ? undefined : required(readVersion(targetVersionId));

    const inheritedIds =
      target?.kind === 'document' ? target.content.blocks.map((block) => block.id) : [];

    assertFreshDerivativeIds(value.content, inheritedIds);

    if (request.kind !== 'document' && value.citations.length === 0)
      throw new StudyError('invalid_input', 'Generated content must cite captured evidence');

    if (new Set(value.citations.map((c) => c.marker)).size !== value.citations.length)
      throw new StudyError('invalid_input', 'Duplicate citation markers');
  }

  function assertFreshDerivativeIds(
    content: typeof materialGenerationPublicationSchema.Type.content,
    inheritedIds: readonly string[] = []
  ) {
    const freshIds =
      content.kind === 'document'
        ? content.blocks
            .filter((block) => !inheritedIds.includes(block.id))
            .map((block) => block.id)
        : [];

    if (
      content.kind === 'document' &&
      freshIds.length &&
      db.orm
        .select({ id: s.blocks.id })
        .from(s.blocks)
        .where(inArray(s.blocks.editing_id, freshIds))
        .get()
    )
      throw new StudyError('invalid_input', 'Derivative block identities must be fresh');
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

    if (request.resultVersionId === null)
      db.orm
        .update(s.material_generation_requests)
        .set({ cancelled: true })
        .where(eq(s.material_generation_requests.id, value.requestId))
        .run();

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
