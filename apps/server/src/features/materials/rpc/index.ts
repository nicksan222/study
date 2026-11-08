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
  { materials: Materials, optionalNotes: Effect.serviceOption(Notes) },
  ({ materials }) => ({
    'materials.previewHistoryPrune': materials.previewHistoryPrune,
    'materials.requestHistoryPrune': materials.requestHistoryPrune,
    'materials.historyPrune': materials.historyPrune,
    'materials.retryHistoryPrune': materials.retryHistoryPrune,
    'materials.previewDeletion': materials.previewDeletion,
    'materials.requestDeletion': materials.requestDeletion,
    'materials.deletion': materials.deletion,
    'materials.retryDeletion': materials.retryDeletion,
    'materials.activeMaterialGenerations': materials.activeMaterialGenerations,
    'materials.materialGeneration': (value) =>
      materials.materialGeneration({ ...value, verifyOnly: true }),
    'materials.cancelMaterialGeneration': materials.cancelMaterialGeneration,
    'materials.retryMaterialGeneration': materials.retryMaterialGenerationOnce,
    'materials.requestMaterialGeneration': materials.requestMaterialGeneration,
    'materials.exportMaterialVersion': materials.exportMaterialVersion,
    'materials.material': materials.material,
    'materials.materials': materials.materials,
    'materials.materialVersion': materials.materialVersion,
    'materials.materialVersions': materials.materialVersions,
    'materials.citations': materials.citations,
    'materials.create': materials.create,
    'materials.createVersion': materials.createVersion,
    'materials.archive': materials.archive,
    'materials.unarchive': materials.unarchive,
    'materials.updateDescription': materials.updateDescription,
    'materials.rename': materials.rename,
    'materials.deleteDraft': materials.deleteDraft,
    'materials.publishVersion': materials.publishVersion,
    'materials.replaceDraft': materials.replaceDraft,
    'materials.setCitations': materials.setCitations,
    'materials.attach': materials.attach,
    'materials.detach': materials.detach,
    'materials.reorder': materials.reorder
  })
);
