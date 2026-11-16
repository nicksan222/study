import { test } from '@study/testing';
import { Response } from 'effect/ai';

import { normalizeUsage } from './usage.ts';

const usage = (
  input: number | undefined,
  cached: number | undefined,
  output: number | undefined
): Response.Usage =>
  new Response.Usage({
    inputTokens: { total: input, uncached: undefined, cacheRead: cached, cacheWrite: undefined },
    outputTokens: { total: output, text: undefined, reasoning: 3 }
  });

test.unit.stable(
  'cached input and reasoning remain subsets of the reported totals',
  ({ expect }) => {
    expect(normalizeUsage(usage(100, 80, 10))).toEqual({
      input: 100,
      cacheRead: 80,
      cacheWrite: 0,
      output: 10,
      reasoning: 3,
      incomplete: false
    });
  }
);

test.unit.stable(
  'unknown and inconsistent counts are marked incomplete without inventing tokens',
  ({ expect }) => {
    expect(normalizeUsage(usage(undefined, undefined, undefined)).incomplete).toBe(true);
    expect(normalizeUsage(usage(10, 20, -1))).toEqual({
      input: 10,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      incomplete: true
    });
  }
);

test.unit.stable(
  'optional native counts can be absent while zero totals remain complete',
  ({ expect }) => {
    expect(
      normalizeUsage(new Response.Usage({ inputTokens: { total: 0 }, outputTokens: { total: 0 } }))
    ).toEqual({
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      incomplete: false
    });
  }
);

test.unit.stable(
  'combined cache counts and reasoning cannot exceed their native totals',
  ({ expect }) => {
    expect(
      normalizeUsage(
        new Response.Usage({
          inputTokens: { total: 100, cacheRead: 60, cacheWrite: 40 },
          outputTokens: { total: 10, reasoning: 10 }
        })
      )
    ).toEqual({
      input: 100,
      cacheRead: 60,
      cacheWrite: 40,
      output: 10,
      reasoning: 10,
      incomplete: false
    });
    expect(
      normalizeUsage(
        new Response.Usage({
          inputTokens: { total: 100, cacheRead: 60, cacheWrite: 41 },
          outputTokens: { total: 10, reasoning: 11 }
        })
      )
    ).toEqual({
      input: 100,
      cacheRead: 0,
      cacheWrite: 0,
      output: 10,
      reasoning: 0,
      incomplete: true
    });
  }
);
