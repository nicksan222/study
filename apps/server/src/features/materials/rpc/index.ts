/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps typed material RPC requests to the materials service.                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Delegates public material operations while keeping domain validation in the service.   │
 * │ - Preserves the public contract while delegating domain behavior to the service.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC schemas come from @study/contracts; domain decisions and persistence                 │
 * │ remain owned by the materials service.                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/service/index';
import { Notes } from '#server/features/notes/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const MaterialsRpcLive = defineRpc(
  MaterialsRpc,
  Effect.gen(function* () {
    const materials = yield* Materials;

    yield* Effect.serviceOption(Notes);

    return {
      'materials.previewHistoryPrune': (value) => materials.previewHistoryPrune(value),
      'materials.requestHistoryPrune': (value) => materials.requestHistoryPrune(value),
      'materials.historyPrune': (value) => materials.historyPrune(value),
      'materials.retryHistoryPrune': (value) => materials.retryHistoryPrune(value),
      'materials.previewDeletion': (value) => materials.previewDeletion(value),
      'materials.requestDeletion': (value) => materials.requestDeletion(value),
      'materials.deletion': (value) => materials.deletion(value),
      'materials.retryDeletion': (value) => materials.retryDeletion(value),
      'materials.activeMaterialGenerations': (value) => materials.activeMaterialGenerations(value),
      'materials.materialGeneration': (value) =>
        materials.materialGeneration({ ...value, verifyOnly: true }),
      'materials.cancelMaterialGeneration': (value) => materials.cancelMaterialGeneration(value),
      'materials.retryMaterialGeneration': (value) => materials.retryMaterialGenerationOnce(value),
      'materials.requestMaterialGeneration': (value) => materials.requestMaterialGeneration(value),
      'materials.exportMaterialVersion': (value) => materials.exportMaterialVersion(value),
      'materials.material': (value) => materials.material(value),
      'materials.materials': (value) => materials.materials(value),
      'materials.materialVersion': (value) => materials.materialVersion(value),
      'materials.materialVersions': (value) => materials.materialVersions(value),
      'materials.citations': (value) => materials.citations(value),
      'materials.create': (value) => materials.create(value),
      'materials.createVersion': (value) => materials.createVersion(value),
      'materials.archive': (value) => materials.archive(value),
      'materials.unarchive': (value) => materials.unarchive(value),
      'materials.updateDescription': (value) => materials.updateDescription(value),
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
