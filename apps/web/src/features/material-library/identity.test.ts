import { materialVersionIdSchema } from '@study/contracts/ids';
import type { MaterialId, SourceId } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { expect, expectTypeOf } from 'vite-plus/test';

import { belongsToMaterial, materialId, versionId } from './identity';
import { importedSource, summary } from './test/support';

testStable(
  'validates route identities instead of accepting numeric prefixes or nonpositive IDs',
  () => {
    for (const input of ['0', '-1', '1abc', '1.5', '', '9223372036854775808']) {
      expect(() => materialId(input)).toThrow();
      expect(() => versionId(input)).toThrow();
    }

    expect(materialId('12')).toBe(12n);
    expect(versionId('42')).toBe(Schema.decodeUnknownSync(materialVersionIdSchema)(42n));
  }
);

testStable(
  'keeps source acquisition and learning route identities in distinct branded contracts',
  () => {
    expectTypeOf(importedSource.id).toEqualTypeOf<SourceId>();
    expectTypeOf(importedSource.id).not.toEqualTypeOf<MaterialId>();
    expectTypeOf(summary().id).toEqualTypeOf<MaterialId>();
    expect(summary().kind).toBe('diagram');
  }
);

testStable('rejects a valid version that belongs to a different material', () => {
  expect(belongsToMaterial({ material_id: materialId('2') }, materialId('1'))).toBe(false);
  expect(belongsToMaterial({ material_id: materialId('1') }, materialId('1'))).toBe(true);
});
