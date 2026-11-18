import { test } from '@study/testing';

import { createVoiceMock } from './voice.ts';

test.server.stable(
  'disposing the voice fixture cancels a held recognition without a caller signal',
  async ({ expect }) => {
    using voice = createVoiceMock();
    const held = voice.next({ text: 'Late speech' }, { hold: true });
    const outcome = voice.runtime.transcribe!(
      { samples: [1], assetPath: () => '', filterSilence: false, denoise: false },
      new AbortController().signal
    );
    const cancelled = expect(outcome).rejects.toHaveProperty('name', 'AbortError');

    await held.called;
    voice[Symbol.dispose]();
    // Release as well so a broken cancellation path fails the assertion without a timeout.
    held.release();
    await cancelled;
    await held.aborted;
  }
);
