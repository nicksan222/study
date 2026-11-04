/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Encodes exact captured target and evidence roles for Document generation.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Carries whole target rich content and only explicitly captured supporting passages.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure captured-input policy; native Activities own provider execution and                 │
 * │ validation.                                                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import type { transformSnapshotSchema } from '@study/contracts/documents/transform';
import { StudyError } from '@study/contracts/errors';
import type { StudyDocumentVersionId } from '@study/contracts/ids';

import { authorizedTransformAssets } from './document-transform.ts';

function inputRole(
  versionId: StudyDocumentVersionId | undefined,
  editTargetVersionId: StudyDocumentVersionId | undefined
) {
  if (editTargetVersionId === undefined) return 'source';

  return versionId === editTargetVersionId ? 'editable_target' : 'supporting_evidence';
}

export function documentTransformPrompt(
  request: typeof transformSnapshotSchema.Type,
  context: typeof runSelectionContextSchema.Type
) {
  const editTargetVersionId = request.editTargetVersionId;
  const editTarget = context.inputs.find(
    (target) => target.input.kind === 'document' && target.input.versionId === editTargetVersionId
  );

  if (
    editTargetVersionId !== undefined &&
    (!editTarget?.document || editTarget.scope.kind !== 'document')
  )
    throw new StudyError('invalid_input', 'Exact editable target is unavailable');

  const captured = {
    editTarget: editTarget
      ? {
          input: editTarget.input,
          snapshotId: editTarget.snapshotId,
          documentId: editTarget.documentId,
          document: editTarget.document
        }
      : undefined,
    title: request.title,
    operations: request.operations,
    instruction: context.instruction,
    preferences: context.preferences,
    assets: authorizedTransformAssets(context),
    messages: context.messages,
    excludedMessages: context.excludedMessages,
    inputs: context.inputs.map((target) => ({
      role: inputRole(
        target.input.kind === 'document' ? target.input.versionId : undefined,
        editTargetVersionId
      ),
      input: target.input,
      name: target.name,
      excerpts: target.excerpts
    }))
  };

  return {
    editTarget,
    prompt: JSON.stringify(captured, (_, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value
    )
  };
}
