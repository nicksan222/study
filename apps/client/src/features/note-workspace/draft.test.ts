import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { acceptText, prepareAsk } from './draft';

const noteId = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

test.stable(
  'replays the exact Ask after a transport failure even when the draft, revision and preferences change',
  () => {
    const original = prepareAsk(
      { text: 'Explain the selected passage', instruction: '' },
      { noteId, expectedSelectionRevision: 9n, preferences: { language: 'italian' } },
      'original-intent'
    );
    const retry = prepareAsk(
      { text: 'A newer unsent note', instruction: '', askAttempt: original },
      { noteId, expectedSelectionRevision: 10n, preferences: { language: 'english' } },
      'must-not-be-used'
    );

    test.expect(retry).toBe(original);
    test.expect(retry.noteId).toBe(9007199254740993n);
    test.expect(retry.intentKey).toBe('original-intent');
    test.expect(retry.expectedSelectionRevision).toBe(9n);
    test.expect(retry.text).toBe('Explain the selected passage');
    test.expect(retry.preferences?.language).toBe('italian');
  }
);

test.stable('preserves typing that happened after submission when its receipt arrives', () => {
  const attempt = prepareAsk(
    { text: 'Submitted', instruction: '' },
    { noteId, expectedSelectionRevision: 0n },
    'intent'
  );
  const accepted = acceptText(
    { text: 'New unsent text', instruction: '', askAttempt: attempt },
    'Submitted'
  );

  test.expect(accepted.text).toBe('New unsent text');
  test.expect(accepted.askAttempt).toBeUndefined();
});

test.stable('clears submitted text only after a successful receipt', () => {
  test
    .expect(
      acceptText({ text: 'Saved note', instruction: '', noteAttempt: 'Saved note' }, 'Saved note')
    )
    .toEqual({ text: '', instruction: '', askAttempt: undefined, noteAttempt: undefined });
});
