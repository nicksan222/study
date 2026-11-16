import { StudyError } from '@study/contracts';
import { test } from '@study/testing';

import { toStudyError } from './errors';

test.stable('preserves canonical failures', () => {
  const error = new StudyError('auth', 'login');

  test.expect(toStudyError(error)).toBe(error);
});

test.stable('decodes structured server failures and retry hints without matching messages', () => {
  const error = { message: 'limited', kind: 'rate_limited', retryAfterMs: 500 };
  const failure = toStudyError(error);

  test.expect(failure.kind).toBe('rate_limited');
  test.expect(failure.retryAfterMs).toBe(500);
  test.expect(failure.cause).toBe(error);
});

test.stable('classifies transport failures and retains their original cause', () => {
  const cause = new TypeError('network');
  const failure = toStudyError(cause);

  test.expect(failure.kind).toBe('transient');
  test.expect(failure.cause).toBe(cause);
});
