import { test } from '@study/testing';
import { Schema } from 'effect';

import { failureSchema, StudyError } from '../src/errors.ts';

for (const resource of [undefined, 'ai_capacity'] as const)
  test.stable(`failure JSON remains recognizable without a typed decoder: ${resource}`, () => {
    const failure = new StudyError('rate_limited', 'Busy', resource ? { resource } : undefined);
    const stored: unknown = JSON.parse(
      JSON.stringify(Schema.encodeSync(Schema.toCodecJson(failureSchema))(failure))
    );

    test.expect(Schema.is(failureSchema)(stored)).toBe(true);
    test.expect(stored).toMatchObject({ kind: 'rate_limited', retryAfterMs: null });
    test.expect(Schema.decodeUnknownSync(failureSchema)(stored).resource).toBe(resource);
  });
