import { materialVersionIdSchema, sourceIdSchema } from '@study/contracts/ids';
import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { Schema } from 'effect';
import { expect, it } from 'vite-plus/test';

import { acceptedMaterial, belongsToMaterial, materialId, versionId } from './identity';

it('validates route identities instead of accepting numeric prefixes or nonpositive IDs', () => {
  for (const input of ['0', '-1', '1abc', '1.5', '', '9223372036854775808']) {
    expect(() => materialId(input)).toThrow();
    expect(() => versionId(input)).toThrow();
  }

  expect(materialId('12')).toBe(12n);
  expect(versionId('42')).toBe(Schema.decodeUnknownSync(materialVersionIdSchema)(42n));
});

it('does not confuse Source identity with Material identity or titles during bounded import recovery', () => {
  const sourceId = Schema.decodeUnknownSync(sourceIdSchema)(7n);
  const otherSourceId = Schema.decodeUnknownSync(sourceIdSchema)(8n);
  const visible = [
    { id: materialId('7'), title: 'Same title', importProcessing: { sourceId: otherSourceId } },
    { id: materialId('99'), title: 'Renamed', importProcessing: { sourceId } }
  ] as MaterialSummaryDto[];

  expect(acceptedMaterial({ id: sourceId }, visible)?.id).toBe(99n);
  expect(acceptedMaterial({ id: sourceId }, visible.slice(0, 1))).toBeUndefined();
  expect(acceptedMaterial({ id: sourceId }, [])).toBeUndefined();
});

it('rejects a valid version that belongs to a different material', () => {
  expect(belongsToMaterial({ material_id: materialId('2') }, materialId('1'))).toBe(false);
  expect(belongsToMaterial({ material_id: materialId('1') }, materialId('1'))).toBe(true);
});
