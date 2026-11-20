/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates exact authored inputs and captures durable page merge requests.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validate immutable versions and publish durable generation requests.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Merge policy stays within Pages services and caller owned transactions.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import * as t from '@study/contracts';
import type { Transaction } from '@study/server';
import { Schema, Option } from 'effect';

import { PagesStore, PageVersionsStore } from '#server/features/pages/store/index';
import { PageTransformsStore } from '#server/features/pages/store/transforms';

/** Exact immutable versions are the durable capture; no synthetic note is created. */
export function standaloneTransformContext(
  tx: Transaction,
  v: typeof t.transformKeySchema.Type
): typeof t.pageTransformContextSchema.Type {
  const request = tx.store(PageTransformsStore).transform(v);

  const capture = request.merge ?? request.improvement;

  if (!capture) throw new StudyError('invalid_input', 'No standalone transform capture');

  const versions = request.improvement ? [request.improvement.versionId] : request.merge!.versions;
  const inputs = versions.map((id) => {
    const version = tx.store(PageVersionsStore).version({ id });
    const doc = tx.store(PagesStore).page({ id: version.pageId });

    if (version.status !== 'published')
      throw new StudyError('invalid_input', 'Merge requires published pages');

    const excerpts = version.document.blocks.flatMap((block, blockOrdinal) =>
      block.text.trim()
        ? [
            {
              blockId: block.id,
              blockOrdinal,
              start: 0,
              end: block.text.length,
              text: block.text,
              anchor: block.anchor,
              content: block.content
            }
          ]
        : []
    );

    if (!excerpts.length) throw new StudyError('invalid_input', 'Merge input has no text');

    return {
      input: { kind: 'page' as const, versionId: id },
      scope: { kind: 'document' as const },
      snapshotId: version.snapshotId,
      pageId: version.pageId,
      name: doc.title,
      document: version.document,
      excerpts
    };
  });

  if (new Set(inputs.map((input) => input.pageId)).size !== inputs.length)
    throw new StudyError('invalid_input', 'Select distinct pages');

  if (
    inputs.reduce(
      (size, input) =>
        size +
        JSON.stringify(input.document, (_, value: unknown) =>
          typeof value === 'bigint' ? String(value) : value
        ).length,
      0
    ) > 200000
  )
    throw new StudyError('invalid_input', 'Selected pages exceed merge limits');

  return {
    requestId: request.contextRequestId,
    noteId: null,
    intentKey: capture.key,
    instruction: request.instruction,
    preferences: { language: capture.language },
    selectionRevision: 0n,
    inputs,
    messages: [],
    excludedMessages: 0
  };
}

export function requestMerge(tx: Transaction, input: typeof t.mergeRequestSchema.Type) {
  const value = Schema.decodeUnknownSync(t.mergeRequestSchema)(input);
  const store = tx.store(PageTransformsStore);
  const contextRequestId = `merge/${value.key}`;
  const old = store.findTransform({ requestId: `document/${contextRequestId}` });
  const result = store.requestTransform({
    contextRequestId,
    title: value.title,
    operations: ['combine', 'deduplicate', 'structure'],
    noteId: null,
    instruction: value.instruction,
    merge: value
  });

  if (Option.isSome(old)) return result.request;

  const context = standaloneTransformContext(tx, { requestId: result.request.id });

  for (const input of context.inputs) {
    const page = tx.store(PagesStore).page({ id: input.pageId! });

    if (
      page.headVersionId !== (input.input.kind === 'page' ? input.input.versionId : null) ||
      page.archivedAt !== null
    )
      throw new StudyError('invalid_input', 'Select current, active page versions');
  }

  emitStandaloneRequested(tx, result.request);

  return result.request;
}

function emitStandaloneRequested(tx: Transaction, request: typeof t.transformSnapshotSchema.Type) {
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

export function requestImprovement(tx: Transaction, input: typeof t.improvePageSchema.Type) {
  const version = tx.store(PageVersionsStore).version({ id: input.versionId });
  const page = tx.store(PagesStore).page({ id: version.pageId });
  const store = tx.store(PageTransformsStore);
  const contextRequestId = `improve/${input.key}`;
  const old = store.findTransform({ requestId: `document/${contextRequestId}` });
  const result = store.requestTransform({
    contextRequestId,
    title: Option.isSome(old) ? old.value.title : page.title,
    operations: ['clarity', 'grammar'],
    noteId: null,
    editTargetVersionId: version.id,
    instruction: input.instruction,
    improvement: input
  });

  if (result.created) {
    if (
      page.headVersionId !== version.id ||
      page.archivedAt !== null ||
      (input.projectId !== undefined && !page.projectIds.includes(input.projectId))
    )
      throw new StudyError(
        'invalid_input',
        'Improvement requires a current document in this subject'
      );

    standaloneTransformContext(tx, { requestId: result.request.id });
    emitStandaloneRequested(tx, result.request);
  }

  return result.request;
}
