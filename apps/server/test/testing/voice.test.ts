import { test } from '@study/testing';

import { createVoiceMock } from './voice.ts';

test.server.stable(
  'disposing the voice fixture cancels a held recognition without a caller signal',
  async ({ expect, withinTestDeadline }) => {
    using voice = createVoiceMock();
    const held = voice.next({ text: 'Late speech' }, { hold: true });
    const outcome = voice.runtime.transcribe!(
      { samples: [1], assetPath: () => '', filterSilence: false, denoise: false },
      new AbortController().signal
    );
    const cancelled = expect(outcome).rejects.toHaveProperty('name', 'AbortError');

    try {
      await withinTestDeadline(held.called);
      voice[Symbol.dispose]();
      await withinTestDeadline(Promise.all([cancelled, held.aborted]));
    } finally {
      held.release();
    }
  }
);

test.server.stable(
  'withdraws an unused voice reply without withdrawing a requested reply',
  async ({ expect, withinTestDeadline }) => {
    using voice = createVoiceMock();
    const unused = voice.next({ text: 'Discarded before recording' });
    const current = voice.next({ text: 'Current recording' }, { hold: true });

    unused.withdraw();
    const input = { samples: [1], assetPath: () => '', filterSilence: false, denoise: false };
    const result = voice.runtime.transcribe!(input, new AbortController().signal);

    try {
      await withinTestDeadline(current.called);
      current.withdraw();
      current.release();
      await expect(result).resolves.toEqual({ text: 'Current recording' });
    } finally {
      current.release();
    }
  }
);
