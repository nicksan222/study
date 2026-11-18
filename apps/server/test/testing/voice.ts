import { StudyError } from '@study/contracts';
import { createControlledOperation } from '@study/testing';
import { CryptoHasher } from 'bun';

import type { VoiceRuntimeAdapters } from '#server/platform/speech/runtime';

type Input = Parameters<NonNullable<VoiceRuntimeAdapters['transcribe']>>[0];

/** Controls only the native inference boundary; installation, services, RPC and capture stay real. */
export function createVoiceMock() {
  const lifetime = new AbortController();
  const bodies = ['browser-asr-fixture', 'browser-vad-fixture'].map((text) =>
    new TextEncoder().encode(text)
  );
  const assets = bodies.map((body, index) => ({
    filename: `speech-fixture-${index}.gguf`,
    url: `https://voice-fixture.invalid/${index}`,
    size: body.length,
    sha256: new CryptoHasher('sha256').update(body).digest('hex')
  }));
  const plans: {
    consumed: boolean;
    execute: (input: Input, signal: AbortSignal) => Promise<{ text: string }>;
  }[] = [];

  const failures: Error[] = [];
  const fail = (message: string): never => {
    const error = new Error(message);

    failures.push(error);

    throw error;
  };
  let downloads = 0;
  let download: ReturnType<typeof createControlledOperation<void, void>> | undefined;

  const runtime: VoiceRuntimeAdapters = {
    assets,
    fetch: async (url, options) => {
      downloads++;
      const index = assets.findIndex((asset) => asset.url === url);

      if (index < 0) fail(`Unexpected voice fixture download: ${url}`);

      if (download) {
        const held = download;

        download = undefined;
        const signal = options?.signal
          ? AbortSignal.any([lifetime.signal, options.signal])
          : lifetime.signal;

        await held.run(undefined, signal);
      }

      return new Response(bodies[index]);
    },
    transcribe: async (input, signal) => {
      const plan = plans.find((entry) => !entry.consumed);

      if (!plan) return fail('Unexpected native voice inference');

      plan.consumed = true;

      return plan.execute(input, AbortSignal.any([lifetime.signal, signal]));
    }
  };

  return {
    runtime,
    get downloads() {
      return downloads;
    },
    holdDownload() {
      if (download) throw new Error('A download is already held');

      const held = createControlledOperation<void, void>(() => undefined, { hold: true });

      download = held;

      return { called: held.called, aborted: held.aborted, release: held.release };
    },
    next(outcome: { text: string } | { error: 'transient' }, options: { hold?: boolean } = {}) {
      const operation = createControlledOperation((_: Input) => {
        if ('error' in outcome)
          throw new StudyError(outcome.error, 'Voice fixture inference failed');

        return outcome;
      }, options);

      plans.push({ consumed: false, execute: operation.run });

      return { called: operation.called, aborted: operation.aborted, release: operation.release };
    },
    [Symbol.dispose]() {
      lifetime.abort();

      if (failures.length) throw new AggregateError(failures, 'Unexpected voice fixture calls');

      if (download) throw new Error('Unused held voice download');

      if (plans.some((plan) => !plan.consumed))
        throw new Error('Unused native voice inference expectation');
    }
  };
}
