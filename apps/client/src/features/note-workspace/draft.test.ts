import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { acceptText, prepareAsk } from './draft';

const noteId = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

test.unit.stable(
  'replays the exact Ask after a transport failure even when the draft, revision and preferences change',
  ({ expect }) => {
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

    expect(retry).toBe(original);
    expect(retry.noteId).toBe(9007199254740993n);
    expect(retry.intentKey).toBe('original-intent');
    expect(retry.expectedSelectionRevision).toBe(9n);
    expect(retry.text).toBe('Explain the selected passage');
    expect(retry.preferences?.language).toBe('italian');
  }
);

test.unit.stable(
  'preserves typing that happened after submission when its receipt arrives',
  ({ expect }) => {
    const attempt = prepareAsk(
      { text: 'Submitted', instruction: '' },
      { noteId, expectedSelectionRevision: 0n },
      'intent'
    );
    const accepted = acceptText(
      { text: 'New unsent text', instruction: '', askAttempt: attempt },
      'Submitted'
    );

    expect(accepted.text).toBe('New unsent text');
    expect(accepted.askAttempt).toBeUndefined();
  }
);

test.unit.stable('clears submitted text only after a successful receipt', ({ expect }) => {
  expect(
    acceptText({ text: 'Saved note', instruction: '', noteAttempt: 'Saved note' }, 'Saved note')
  ).toEqual({ text: '', instruction: '', askAttempt: undefined, noteAttempt: undefined });
});
