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
import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId } from '@study/contracts/ids';
import type { materialGenerationSnapshotSchema } from '@study/contracts/materials/schemas';

import { authorizedTransformAssets } from './document-transform.ts';

function inputRole(
  versionId: MaterialVersionId,
  editTargetVersionId: MaterialVersionId | undefined
) {
  if (editTargetVersionId === undefined) return 'source';

  return versionId === editTargetVersionId ? 'editable_target' : 'supporting_evidence';
}

export function documentTransformPrompt(
  request: typeof materialGenerationSnapshotSchema.Type,
  context: typeof runSelectionContextSchema.Type
) {
  const editTargetVersionId = request.documentTransform?.editTargetVersionId;
  const editTarget = context.inputs.find((target) => target.versionId === editTargetVersionId);

  if (
    editTargetVersionId !== undefined &&
    (!editTarget?.document || editTarget.scope.kind !== 'document')
  )
    throw new StudyError('invalid_input', 'Exact editable target is unavailable');

  const captured = {
    editTarget: editTarget
      ? {
          materialId: editTarget.materialId,
          versionId: editTarget.versionId,
          documentId: editTarget.documentId,
          document: editTarget.document
        }
      : undefined,
    title: request.title,
    operations: request.documentTransform?.operations,
    instruction: context.instruction,
    preferences: context.preferences,
    assets: authorizedTransformAssets(context),
    messages: context.messages,
    excludedMessages: context.excludedMessages,
    inputs: context.inputs.map((target) => ({
      role: inputRole(target.versionId, editTargetVersionId),
      versionId: target.versionId,
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
