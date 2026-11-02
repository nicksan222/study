/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps typed material RPC requests to the materials service.                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Delegates public material operations while keeping domain validation in the service.   │
 * │ - Preserves the public contract while delegating domain behavior to the service.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC schemas come from @study/contracts; domain decisions and persistence remain owned by │
 * │ the materials service.                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { Effect, Option } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const MaterialsRpcLive = defineRpc(
  MaterialsRpc,
  Effect.gen(function* () {
    const materials = yield* Materials;
    const conversations = yield* Effect.serviceOption(Conversations);

    return {
      'materials.requestDocumentTransform': (value) =>
        Option.isSome(conversations)
          ? conversations.value.requestDocumentTransform(value)
          : Effect.fail(new StudyError('unsupported', 'Session service is unavailable')),
      'materials.materialGeneration': (value) =>
        materials.materialGeneration({ ...value, verifyOnly: true }),
      'materials.cancelMaterialGeneration': (value) => materials.cancelMaterialGeneration(value),
      'materials.retryMaterialGeneration': (value) =>
        materials
          .materialGeneration({ ...value, verifyOnly: true })
          .pipe(
            Effect.flatMap((request) =>
              request.documentTransform
                ? Option.isSome(conversations)
                  ? conversations.value.retryDocumentTransform(value)
                  : Effect.fail(new StudyError('unsupported', 'Session service is unavailable'))
                : materials.retryMaterialGenerationOnce(value)
            )
          ),
      'materials.requestMaterialGeneration': (value) => materials.requestMaterialGeneration(value),
      'materials.material': (value) => materials.material(value),
      'materials.materials': (value) => materials.materials(value),
      'materials.materialVersion': (value) => materials.materialVersion(value),
      'materials.materialVersionExport': (value) => materials.materialVersionExport(value),
      'materials.materialVersions': (value) => materials.materialVersions(value),
      'materials.inputs': (value) => materials.inputs(value),
      'materials.dependents': (value) => materials.dependents(value),
      'materials.citations': (value) => materials.citations(value),
      'materials.create': (value) => materials.create(value),
      'materials.createVersion': (value) => materials.createVersion(value),
      'materials.archive': (value) => materials.archive(value),
      'materials.unarchive': (value) => materials.unarchive(value),
      'materials.rename': (value) => materials.rename(value),
      'materials.deleteDraft': (value) => materials.deleteDraft(value),
      'materials.publishVersion': (value) => materials.publishVersion(value),
      'materials.replaceDraft': (value) => materials.replaceDraft(value),
      'materials.setCitations': (value) => materials.setCitations(value),
      'materials.attach': (value) => materials.attach(value),
      'materials.detach': (value) => materials.detach(value),
      'materials.reorder': (value) => materials.reorder(value)
    };
  })
);
