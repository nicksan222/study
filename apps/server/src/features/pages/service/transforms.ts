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

import { StudyError } from '@study/contracts';
import type { exactInputSchema } from '@study/contracts';
import type { pageTransformContextSchema } from '@study/contracts';
import * as t from '@study/contracts';
import type { Transaction } from '@study/server';
import { Schema } from 'effect';

import { intentHash } from '#server/features/pages/decoders/intent';
import { validatePageTransform } from '#server/features/pages/decoders/page-transform';
import {
  PagesStore,
  PageProposalsStore,
  PageVersionsStore
} from '#server/features/pages/store/index';
import { PageTransformsStore } from '#server/features/pages/store/transforms';

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
  const versionId = publishCapturedVersion(tx, request, context, common);

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

function publishCapturedVersion(
  tx: Transaction,
  request: typeof t.transformSnapshotSchema.Type,
  context: Context,
  common: ReturnType<typeof publicationContent>
) {
  if (request.editTargetVersionId === undefined)
    return tx.store(PagesStore).createGenerated({
      ...common,
      title: request.title,
      noteId: context.noteId ?? undefined,
      projectId: request.merge?.projectId
    }).version.id;

  const base = tx.store(PageVersionsStore).version({ id: request.editTargetVersionId });

  return tx.store(PageProposalsStore).proposeGenerated({
    ...common,
    ...(request.improvement ? preserveDocumentEvidence(base, common) : {}),
    pageId: base.pageId,
    expectedVersionId: base.id,
    key: `transform:${intentHash(t.transformKeySchema, { requestId: request.id })}`
  }).proposedVersionId;
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

/** Preserve original evidence and managed illustrations in a proposed revision. */
function preserveDocumentEvidence(
  base: typeof t.versionSchema.Type,
  generated: ReturnType<typeof publicationContent>
) {
  const sameInput = Schema.toEquivalence(t.exactInputSchema);
  const inputs = [
    ...generated.inputs,
    ...base.inputs.filter((input) => !generated.inputs.some((other) => sameInput(input, other)))
  ];
  const markers = new Set(generated.citations.map((citation) => citation.marker));
  let marker = Math.max(0, ...markers, ...base.citations.map((citation) => citation.marker));
  const citations = [
    ...generated.citations,
    ...base.citations.map((citation) =>
      markers.has(citation.marker) ? { ...citation, marker: ++marker } : citation
    )
  ];
  const generatedBlocks = new Map(generated.document.blocks.map((block) => [block.id, block]));
  const illustrations = base.document.blocks.filter(
    (block) =>
      block.content.type === 'image' && generatedBlocks.get(block.id)?.content.type !== 'image'
  );
  const illustrationIds = new Set(illustrations.map((block) => block.id));

  return {
    inputs,
    citations,
    document: {
      ...generated.document,
      blocks: [
        ...generated.document.blocks.filter((block) => !illustrationIds.has(block.id)),
        ...illustrations
      ]
    }
  };
}
