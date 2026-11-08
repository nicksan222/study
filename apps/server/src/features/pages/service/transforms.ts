/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates captured transform requests and coordinates exact authored publication.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates captured transform requests and coordinates exact authored publication.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { exactInputSchema } from '@study/contracts/pages/schemas';
import type { pageTransformContextSchema } from '@study/contracts/pages/transform';
import * as t from '@study/contracts/pages/transform';

import { intentHash } from '#server/features/pages/decoders/intent';
import { validatePageTransform } from '#server/features/pages/decoders/page-transform';
import {
  PagesStore,
  PageProposalsStore,
  PageVersionsStore
} from '#server/features/pages/store/index';
import { PageTransformsStore } from '#server/features/pages/store/transforms';
import type { Transaction } from '#server/platform/definitions/define-store';

type Context = typeof pageTransformContextSchema.Type;

export function requestTransform(
  tx: Transaction,
  context: Context,
  value: typeof t.transformRequestSchema.Type
) {
  if (context.requestId !== value.contextRequestId)
    throw new StudyError('invalid_input', 'Captured context mismatch');

  if (
    value.editTargetVersionId !== undefined &&
    !context.inputs.some(
      (input) =>
        input.input.kind === 'page' &&
        input.input.versionId === value.editTargetVersionId &&
        input.scope.kind === 'document'
    )
  )
    throw new StudyError('invalid_input', 'Proposals require a captured whole authored version');

  const result = tx
    .store(PageTransformsStore)
    .requestTransform({ ...value, noteId: context.noteId, instruction: context.instruction });

  if (result.created) emitRequested(tx, result.request);

  return result.request;
}

function publicationContent(
  request: typeof t.transformSnapshotSchema.Type,
  context: Context,
  value: typeof t.transformPublicationSchema.Type
) {
  const inputs: (typeof exactInputSchema.Type)[] = [
    ...context.inputs.map((input) => input.input),
    ...context.messages.map((message) => ({
      kind: 'message' as const,
      versionId: message.versionId
    }))
  ];

  return {
    requestId: request.id,
    document: value.document,
    inputs,
    citations: value.citations,
    operation: request.operations.includes('translate')
      ? ('translate' as const)
      : request.operations.includes('summarize')
        ? ('summarize' as const)
        : ('generate' as const),
    instruction: request.instruction || request.operations.join(', '),
    language: value.language ?? null
  };
}

export function publishTransform(
  tx: Transaction,
  context: Context | undefined,
  value: typeof t.transformPublicationSchema.Type
) {
  const store = tx.store(PageTransformsStore);
  const request = store.transform(value);

  if (request.cancelled || request.eventId !== value.generationEventId)
    throw new StudyError('cancelled', 'Page generation is no longer active');

  if (request.resultVersionId !== null) {
    store.finishTransform({ ...value, versionId: request.resultVersionId });

    return request.resultVersionId;
  }

  if (
    !context ||
    context.requestId !== request.contextRequestId ||
    context.instruction !== request.instruction
  )
    throw new StudyError('not_found', 'Captured page inputs are unavailable');

  validateMergeInputs(tx, request);

  validatePageTransform(context, value, request.editTargetVersionId);
  const common = publicationContent(request, context, value);
  let versionId;

  if (request.editTargetVersionId !== undefined) {
    const base = tx.store(PageVersionsStore).version({ id: request.editTargetVersionId });
    const result = tx.store(PageProposalsStore).proposeGenerated({
      ...common,
      pageId: base.pageId,
      expectedVersionId: base.id,
      key: `transform:${intentHash(t.transformKeySchema, value)}`
    });

    versionId = result.proposedVersionId;
  } else {
    const result = tx.store(PagesStore).createGenerated({
      ...common,
      title: request.title,
      noteId: context.noteId ?? undefined,
      projectId: request.merge?.projectId
    });

    versionId = result.version.id;
  }

  archiveMergeInputs(tx, request);

  store.finishTransform({ ...value, versionId });
  tx.emit({
    type: 'PagePublished',
    eventId: `published/${request.id}`,
    causationId: value.generationEventId,
    correlationId: request.id,
    inputVersion: 1,
    depth: 1,
    versionId
  });

  return versionId;
}

export function retryTransform(tx: Transaction, value: { requestId: string; retryId: string }) {
  const store = tx.store(PageTransformsStore);
  const old = store.transform(value);

  if (old.cancelled) throw new StudyError('cancelled', 'Page generation is cancelled');

  if (old.resultVersionId !== null || old.eventId === value.retryId) return old;

  const request = store.changeTransform({
    ...value,
    eventId: value.retryId,
    cancel: false,
    errorKind: null
  });

  emitRequested(tx, request);

  return request;
}

function emitRequested(tx: Transaction, request: typeof t.transformSnapshotSchema.Type) {
  tx.emit({
    type: 'PageGenerationRequested',
    eventId: request.eventId,
    causationId: null,
    correlationId: request.id,
    inputVersion: 1,
    depth: 0,
    requestId: request.id
  });
}

function validateMergeInputs(tx: Transaction, request: typeof t.transformSnapshotSchema.Type) {
  if (request.merge) {
    for (const id of request.merge.versions) {
      const version = tx.store(PageVersionsStore).version({ id });
      const page = tx.store(PagesStore).page({ id: version.pageId });

      if (page.headVersionId !== id || page.archivedAt !== null)
        throw new StudyError('invalid_input', 'A selected page changed during the merge');
    }
  }
}

function archiveMergeInputs(tx: Transaction, request: typeof t.transformSnapshotSchema.Type) {
  if (request.merge)
    for (const id of request.merge.versions) {
      const version = tx.store(PageVersionsStore).version({ id });

      tx.store(PagesStore).archive({ id: version.pageId, archived: true });
    }
}
