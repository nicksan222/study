import { materialVersionIdSchema } from '@study/contracts';
import type { MaterialId, SourceId } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { belongsToMaterial, materialId, versionId } from './identity';
import { importedSource, summary } from './test/support';

test.stable(
  'validates route identities instead of accepting numeric prefixes or nonpositive IDs',
  () => {
    for (const input of ['0', '-1', '1abc', '1.5', '', '9223372036854775808']) {
      test.expect(() => materialId(input)).toThrow();
      test.expect(() => versionId(input)).toThrow();
    }

    test.expect(materialId('12')).toBe(12n);
    test.expect(versionId('42')).toBe(Schema.decodeUnknownSync(materialVersionIdSchema)(42n));
  }
);

test.stable(
  'keeps source acquisition and learning route identities in distinct branded contracts',
  () => {
    test.expectTypeOf(importedSource.id).toEqualTypeOf<SourceId>();
    test.expectTypeOf(importedSource.id).not.toEqualTypeOf<MaterialId>();
    test.expectTypeOf(summary().id).toEqualTypeOf<MaterialId>();
    test.expect(summary().kind).toBe('flashcards');
  }
);

test.stable('rejects a valid version that belongs to a different material', () => {
  test.expect(belongsToMaterial({ material_id: materialId('2') }, materialId('1'))).toBe(false);
  test.expect(belongsToMaterial({ material_id: materialId('1') }, materialId('1'))).toBe(true);
});
