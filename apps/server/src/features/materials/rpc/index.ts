import type { StudyError } from '@study/contracts/errors';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const MaterialsRpcLive = MaterialsRpc.toLayer(
  Effect.gen(function* () {
    const materials = yield* Materials;

    return {
      'materials.requestMaterialGeneration': (value) =>
        materials.requestMaterialGeneration(value).pipe(Effect.mapError(failure)),
      'materials.material': (value) => materials.material(value).pipe(Effect.mapError(failure)),
      'materials.materials': (value) => materials.materials(value).pipe(Effect.mapError(failure)),
      'materials.materialVersion': (value) =>
        materials.materialVersion(value).pipe(Effect.mapError(failure)),
      'materials.materialVersionExport': (value) =>
        materials.materialVersionExport(value).pipe(Effect.mapError(failure)),
      'materials.materialVersions': (value) =>
        materials.materialVersions(value).pipe(Effect.mapError(failure)),
      'materials.inputs': (value) => materials.inputs(value).pipe(Effect.mapError(failure)),
      'materials.dependents': (value) => materials.dependents(value).pipe(Effect.mapError(failure)),
      'materials.citations': (value) => materials.citations(value).pipe(Effect.mapError(failure)),
      'materials.create': (value) => materials.create(value).pipe(Effect.mapError(failure)),
      'materials.createVersion': (value) =>
        materials.createVersion(value).pipe(Effect.mapError(failure)),
      'materials.archive': (value) => materials.archive(value).pipe(Effect.mapError(failure)),
      'materials.unarchive': (value) => materials.unarchive(value).pipe(Effect.mapError(failure)),
      'materials.rename': (value) => materials.rename(value).pipe(Effect.mapError(failure)),
      'materials.deleteDraft': (value) =>
        materials.deleteDraft(value).pipe(Effect.mapError(failure)),
      'materials.publishVersion': (value) =>
        materials.publishVersion(value).pipe(Effect.mapError(failure)),
      'materials.replaceDraft': (value) =>
        materials.replaceDraft(value).pipe(Effect.mapError(failure)),
      'materials.setCitations': (value) =>
        materials.setCitations(value).pipe(Effect.mapError(failure)),
      'materials.attach': (value) => materials.attach(value).pipe(Effect.mapError(failure)),
      'materials.detach': (value) => materials.detach(value).pipe(Effect.mapError(failure)),
      'materials.reorder': (value) => materials.reorder(value).pipe(Effect.mapError(failure))
    };
  })
);
