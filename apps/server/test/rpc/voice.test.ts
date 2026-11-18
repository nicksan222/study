import { MAX_DICTATION_SAMPLES, StudyRpc, dictationInputSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';

test.server.stable(
  'a complete 30-second dictation segment fits native HTTP RPC without losing PCM16 samples',
  async ({ resources, expect, voice }) => {
    const expected = voice.next({ text: 'Complete dictation' });
    const { server } = await resources.openRpc({ voice: voice.runtime });
    const samples = Array.from({ length: MAX_DICTATION_SAMPLES }, (_, index) =>
      index % 2 ? -32768 : 32767
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

          yield* client['voice.install']({});
          expect(yield* client['voice.transcribe']({ samples })).toEqual({
            text: 'Complete dictation'
          });
        })
      )
    );
    const received = await expected.called;

    expect(received.samples).toEqual(samples);
  }
);

test.unit.stable(
  'dictation rejects audio beyond its bound and values outside PCM16',
  async ({ expect }) => {
    const accepts = Schema.is(dictationInputSchema);

    expect(accepts({ samples: Array(MAX_DICTATION_SAMPLES + 1).fill(0) })).toBe(false);

    for (const sample of [32768, -32769, 0.5, NaN, Infinity])
      expect(accepts({ samples: [sample] })).toBe(false);

    expect(accepts({ samples: [] })).toBe(false);
  }
);
