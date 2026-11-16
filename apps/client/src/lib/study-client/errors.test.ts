import { StudyError } from '@study/contracts';
import { test } from '@study/testing';

import { toStudyError } from './errors';

test.stable('preserves canonical failures', ({ expect }) => {
  const error = new StudyError('auth', 'login');

  expect(toStudyError(error)).toBe(error);
});

test.stable(
  'decodes structured server failures and retry hints without matching messages',
  ({ expect }) => {
    const error = { message: 'limited', kind: 'rate_limited', retryAfterMs: 500 };
    const failure = toStudyError(error);

    expect(failure.kind).toBe('rate_limited');
    expect(failure.retryAfterMs).toBe(500);
    expect(failure.cause).toBe(error);
  }
);

test.stable('classifies transport failures and retains their original cause', ({ expect }) => {
  const cause = new TypeError('network');
  const failure = toStudyError(cause);

  expect(failure.kind).toBe('transient');
  expect(failure.cause).toBe(cause);
});
