/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Encodes exact captured target and evidence roles for Page generation.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Carries whole target rich content and only explicitly captured supporting passages.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure captured-input policy; native Activities own provider execution and                 │
 * │ validation.                                                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { PageVersionId } from '@study/contracts/ids';
import type { pageTransformContextSchema } from '@study/contracts/pages/transform';
import type { transformSnapshotSchema } from '@study/contracts/pages/transform';

import { authorizedTransformAssets } from './page-transform.ts';

function inputRole(
  versionId: PageVersionId | undefined,
  editTargetVersionId: PageVersionId | undefined
) {
  if (editTargetVersionId === undefined) return 'source';

  return versionId === editTargetVersionId ? 'editable_target' : 'supporting_evidence';
}

export function pageTransformPrompt(
  request: typeof transformSnapshotSchema.Type,
  context: typeof pageTransformContextSchema.Type
) {
  const editTargetVersionId = request.editTargetVersionId;
  const editTarget = context.inputs.find(
    (target) => target.input.kind === 'page' && target.input.versionId === editTargetVersionId
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
          pageId: editTarget.pageId,
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
        target.input.kind === 'page' ? target.input.versionId : undefined,
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
