import { createHash } from 'node:crypto';

import { Schema } from 'effect';

/** Schema codecs preserve bigint identity; sorted object keys make replay property-order independent. */
export function intentHash<S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S['Type']
): string {
  const encoded = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(schema)))(value);
  const canonical = JSON.stringify(JSON.parse(encoded), (_, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
  return createHash('sha256').update(canonical).digest('hex');
}
