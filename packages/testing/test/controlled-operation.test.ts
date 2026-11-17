import { test } from '@study/testing';

import { createControlledOperation } from '../src/controlled-operation.ts';

test.unit.stable(
  'controlled operations expose invocation before releasing the real asynchronous boundary',
  async ({ expect }) => {
    const performed: string[] = [];
    const operation = createControlledOperation(
      (input: string) => {
        performed.push(input);

        return input.length;
      },
      { hold: true }
    );
    const result = operation.run('spoken');

    expect(await operation.called).toBe('spoken');
    expect(performed).toEqual([]);
    operation.release();
    expect(await result).toBe(6);
    expect(performed).toEqual(['spoken']);
  }
);

test.unit.stable(
  'controlled operations propagate cancellation and never perform an aborted outcome',
  async ({ expect }) => {
    const performed: string[] = [];

    for (const alreadyAborted of [false, true]) {
      const controller = new AbortController();
      const reason = new Error('cancelled boundary');
      const operation = createControlledOperation(
        (input: string) => {
          performed.push(input);
        },
        { hold: true }
      );

      if (alreadyAborted) controller.abort(reason);

      const result = operation.run('discarded', controller.signal);
      const rejected = expect(result).rejects.toBe(reason);

      await operation.called;
      controller.abort(reason);
      await operation.aborted;
      operation.release();
      await rejected;
    }

    expect(performed).toEqual([]);
  }
);

test.unit.stable(
  'unheld operations preserve their asynchronous outcome and error identity',
  async ({ expect }) => {
    const operation = createControlledOperation(async (input: number) => input + 1);

    expect(await operation.run(4)).toBe(5);
    const failure = new Error('inference unavailable');
    const failed = createControlledOperation(() => {
      throw failure;
    });

    await expect(failed.run(undefined)).rejects.toBe(failure);
  }
);
