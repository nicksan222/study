import { test } from '@study/testing';

import { transcribeInProcess } from './runtime.ts';

test.server.stable.for(['{"text":', '{"text":42}'])(
  'classifies an incomplete or invalid worker response as a model failure (%s)',
  async (output, { spawnTestProcess, expect, vi }) => {
    await using worker = spawnTestProcess(
      [
        process.execPath,
        '-e',
        'await new Response(Bun.stdin.stream()).text(); await Bun.write(Bun.stdout, process.env.TEST_SPEECH_REPLY);'
      ],
      {
        env: { ...process.env, TEST_SPEECH_REPLY: output },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore'
      }
    );
    const spawn = vi.spyOn(Bun, 'spawn').mockReturnValue(worker);

    try {
      await expect(
        transcribeInProcess(
          { samples: [0], modelPath: 'unused', vadPath: 'unused', filterSilence: false },
          new AbortController().signal
        )
      ).rejects.toMatchObject({
        kind: 'model_unavailable',
        cause: expect.any(Error)
      });
    } finally {
      spawn.mockRestore();
    }
  }
);
