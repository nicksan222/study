import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { failureSchema, StudyError } from '../src/errors.ts';

for (const resource of [undefined, 'ai_capacity'] as const)
  testStable(`failure JSON remains recognizable without a typed decoder: ${resource}`, () => {
    const failure = new StudyError('rate_limited', 'Busy', resource ? { resource } : undefined);
    const stored: unknown = JSON.parse(
      JSON.stringify(Schema.encodeSync(Schema.toCodecJson(failureSchema))(failure))
    );

    expect(Schema.is(failureSchema)(stored)).toBe(true);
    expect(stored).toMatchObject({ kind: 'rate_limited', retryAfterMs: null });
    expect(Schema.decodeUnknownSync(failureSchema)(stored).resource).toBe(resource);
  });
