import { test } from '@study/testing';

import { createControlledOperation } from '../src/controlled-operation.ts';

test.unit.stable(
  'does not perform if cancellation arrives after the gate check',
  async ({ expect, vi }) => {
    const controller = new AbortController();
    const reason = new Error('cancelled just before execution');
    const perform = vi.fn();
    const operation = createControlledOperation(perform);

    vi.spyOn(controller.signal, 'throwIfAborted').mockImplementationOnce(() => {
      queueMicrotask(() => controller.abort(reason));
    });

    await expect(operation.run(undefined, controller.signal)).rejects.toBe(reason);
    await operation.aborted;
    expect(perform).not.toHaveBeenCalled();
  }
);

test.unit.stable('reports the abort even if the settled callback throws', async ({ expect }) => {
  const controller = new AbortController();
  const cleanupError = new Error('cleanup failed');
  const operation = createControlledOperation(() => {}, {
    hold: true,
    onSettled: () => {
      throw cleanupError;
    }
  });
  let observedAbort = false;

  void operation.aborted.then(() => {
    observedAbort = true;
  });
  const outcome = operation.run(undefined, controller.signal);

  controller.abort();
  await expect(outcome).rejects.toBe(cleanupError);
  expect(observedAbort).toBe(true);
});

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

test.unit.stable(
  'settles only after asynchronous work completes',
  async ({ expect, vi, withinTestDeadline }) => {
    const started = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<number>();
    const onSettled = vi.fn();
    const operation = createControlledOperation(
      () => {
        started.resolve();

        return completion.promise;
      },
      { onSettled }
    );
    const result = operation.run(undefined);

    await withinTestDeadline(started.promise);
    expect(onSettled).not.toHaveBeenCalled();
    completion.resolve(17);
    await expect(result).resolves.toBe(17);
    expect(onSettled).toHaveBeenCalledOnce();
  }
);
