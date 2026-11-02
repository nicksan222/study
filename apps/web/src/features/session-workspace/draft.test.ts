import { sessionIdSchema } from '@study/contracts/ids';
import { Schema } from 'effect';
import { expect, it } from 'vite-plus/test';

import { acceptText, prepareAsk } from './draft';

const sessionId = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);
it('replays the exact Ask after a transport failure even when the draft, revision and preferences change', () => {
  const original = prepareAsk(
    { text: 'Explain the selected passage', instruction: '' },
    { sessionId, expectedSelectionRevision: 9n, preferences: { language: 'italian' } },
    'original-intent'
  );
  const retry = prepareAsk(
    { text: 'A newer unsent note', instruction: '', askAttempt: original },
    { sessionId, expectedSelectionRevision: 10n, preferences: { language: 'english' } },
    'must-not-be-used'
  );
  expect(retry).toBe(original);
  expect(retry.sessionId).toBe(9007199254740993n);
  expect(retry.intentKey).toBe('original-intent');
  expect(retry.expectedSelectionRevision).toBe(9n);
  expect(retry.text).toBe('Explain the selected passage');
  expect(retry.preferences?.language).toBe('italian');
});
it('preserves typing that happened after submission when its receipt arrives', () => {
  const attempt = prepareAsk(
    { text: 'Submitted', instruction: '' },
    { sessionId, expectedSelectionRevision: 0n },
    'intent'
  );
  const accepted = acceptText(
    { text: 'New unsent text', instruction: '', askAttempt: attempt },
    'Submitted'
  );
  expect(accepted.text).toBe('New unsent text');
  expect(accepted.askAttempt).toBeUndefined();
});
it('clears submitted text only after a successful receipt', () => {
  expect(
    acceptText({ text: 'Saved note', instruction: '', noteAttempt: 'Saved note' }, 'Saved note')
  ).toEqual({ text: '', instruction: '', askAttempt: undefined, noteAttempt: undefined });
});
