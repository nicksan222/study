import { materialVersionIdSchema } from '@study/contracts';
import type { MaterialId, SourceId } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { belongsToMaterial, materialId, versionId } from './identity';
import { importedSource, summary } from './test/support';

test.unit.stable(
  'validates route identities instead of accepting numeric prefixes or nonpositive IDs',
  ({ expect }) => {
    for (const input of ['0', '-1', '1abc', '1.5', '', '9223372036854775808']) {
      expect(() => materialId(input)).toThrow();
      expect(() => versionId(input)).toThrow();
    }

    expect(materialId('12')).toBe(12n);
    expect(versionId('42')).toBe(Schema.decodeUnknownSync(materialVersionIdSchema)(42n));
  }
);

test.unit.stable(
  'keeps source acquisition and learning route identities in distinct branded contracts',
  ({ expectTypeOf, expect }) => {
    expectTypeOf(importedSource.id).toEqualTypeOf<SourceId>();
    expectTypeOf(importedSource.id).not.toEqualTypeOf<MaterialId>();
    expectTypeOf(summary().id).toEqualTypeOf<MaterialId>();
    expect(summary().kind).toBe('flashcards');
  }
);

test.unit.stable('rejects a valid version that belongs to a different material', ({ expect }) => {
  expect(belongsToMaterial({ material_id: materialId('2') }, materialId('1'))).toBe(false);
  expect(belongsToMaterial({ material_id: materialId('1') }, materialId('1'))).toBe(true);
});
