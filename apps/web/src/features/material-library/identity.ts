import { materialIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { Schema } from 'effect';

export function materialId(value: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) throw new Error('Invalid material identity');

  return Schema.decodeUnknownSync(materialIdSchema)(BigInt(value));
}

export function versionId(value: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) throw new Error('Invalid version identity');

  return Schema.decodeUnknownSync(materialVersionIdSchema)(BigInt(value));
}

export function belongsToMaterial(
  version: Pick<MaterialVersionDetailDto, 'material_id'>,
  id: ReturnType<typeof materialId>
) {
  return version.material_id === id;
}
