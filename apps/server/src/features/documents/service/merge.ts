import * as t from '@study/contracts/documents/transform';
import { StudyError } from '@study/contracts/errors';
import { Schema, Option } from 'effect';

import { DocumentsStore, DocumentVersionsStore } from '#server/features/documents/store/index';
import { DocumentTransformsStore } from '#server/features/documents/store/transforms';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Exact immutable versions are the durable capture; no synthetic session is created. */
export function mergeContext(
  tx: Transaction,
  v: typeof t.transformKeySchema.Type
): typeof t.documentTransformContextSchema.Type {
  const request = tx.store(DocumentTransformsStore).transform(v);
  if (!request.merge) throw new StudyError('invalid_input', 'Not a document merge');
  const inputs = request.merge.versions.map((id) => {
    const version = tx.store(DocumentVersionsStore).version({ id });
    const doc = tx.store(DocumentsStore).document({ id: version.documentId });
    if (version.status !== 'published')
      throw new StudyError('invalid_input', 'Merge requires published documents');
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
      input: { kind: 'document' as const, versionId: id },
      scope: { kind: 'document' as const },
      snapshotId: version.snapshotId,
      documentId: version.documentId,
      name: doc.title,
      document: version.document,
      excerpts
    };
  });
  if (new Set(inputs.map((input) => input.documentId)).size !== inputs.length)
    throw new StudyError('invalid_input', 'Select distinct documents');
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
    throw new StudyError('invalid_input', 'Selected documents exceed merge limits');
  return {
    requestId: request.contextRequestId,
    sessionId: null,
    intentKey: request.merge.key,
    instruction: request.instruction,
    preferences: { language: request.merge.language },
    selectionRevision: 0n,
    inputs,
    messages: [],
    excludedMessages: 0
  };
}

export function requestMerge(tx: Transaction, input: typeof t.mergeRequestSchema.Type) {
  const value = Schema.decodeUnknownSync(t.mergeRequestSchema)(input);
  const store = tx.store(DocumentTransformsStore);
  const contextRequestId = `merge/${value.key}`;
  const old = store.findTransform({ requestId: `document/${contextRequestId}` });
  const result = store.requestTransform({
    contextRequestId,
    title: value.title,
    operations: ['combine', 'deduplicate', 'structure'],
    sessionId: null,
    instruction: value.instruction,
    merge: value
  });
  if (Option.isSome(old)) return result.request;
  const context = mergeContext(tx, { requestId: result.request.id });
  for (const input of context.inputs) {
    const document = tx.store(DocumentsStore).document({ id: input.documentId! });
    if (
      document.headVersionId !== (input.input.kind === 'document' ? input.input.versionId : null) ||
      document.archivedAt !== null
    )
      throw new StudyError('invalid_input', 'Select current, active document versions');
  }
  tx.emit({
    type: 'DocumentGenerationRequested',
    eventId: result.request.eventId,
    causationId: null,
    correlationId: result.request.id,
    inputVersion: 1,
    depth: 0,
    requestId: result.request.id
  });
  return result.request;
}
