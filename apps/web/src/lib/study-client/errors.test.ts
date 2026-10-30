import { StudyError } from '@study/contracts/errors';
import { expect, it } from 'vite-plus/test';

import { toStudyError } from './errors';

it('preserves canonical failures', () => {
  const error = new StudyError('auth', 'login');

  expect(toStudyError(error)).toBe(error);
});

it('decodes structured server failures and retry hints without matching messages', () => {
  const error = { message: 'limited', kind: 'rate_limited', retryAfterMs: 500 };
  const failure = toStudyError(error);

  expect(failure.kind).toBe('rate_limited');
  expect(failure.retryAfterMs).toBe(500);
  expect(failure.cause).toBe(error);
});

it('classifies transport failures and retains their original cause', () => {
  const cause = new TypeError('network');
  const failure = toStudyError(cause);

  expect(failure.kind).toBe('transient');
  expect(failure.cause).toBe(cause);
});
