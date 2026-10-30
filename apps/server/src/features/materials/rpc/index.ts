import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const MaterialsRpcLive = defineRpc(
  MaterialsRpc,
  Effect.gen(function* () {
    const materials = yield* Materials;

    return {
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
