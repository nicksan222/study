type Cleanup = () => void | Promise<void>;

/** Normal completion and runner cancellation share one idempotent, reverse-order finalizer. */
export async function owned<T>(
  run: (own: (cleanup: Cleanup) => void) => Promise<T>,
  registerFinalizer?: (close: () => Promise<void>) => void,
  onSuccess?: Cleanup
): Promise<T> {
  const cleanup: Cleanup[] = [];
  const failures: unknown[] = [];
  const late: Promise<void>[] = [];
  let closing: Promise<void> | undefined;
  let result: T | undefined;
  let completed = false;
  let cancelled = false;
  const safely = async (close: Cleanup) => {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  };
  const finalize = () =>
    (closing ??= (async () => {
      while (cleanup.length) await safely(cleanup.pop()!);
    })());

  registerFinalizer?.(async () => {
    if (!completed && !cancelled) {
      cancelled = true;
      failures.push(new Error('E2E cancelled before cleanup completed'));
    }

    await finalize();
  });

  try {
    result = await run((close) => {
      if (closing) {
        late.push(safely(close));

        throw new Error('E2E acquisition completed after teardown');
      }

      cleanup.push(close);
    });
  } catch (error) {
    failures.unshift(error);
  } finally {
    await finalize();
    await Promise.all(late);
  }

  if (failures.length) throw new AggregateError(failures, 'Web E2E failed');

  completed = true;
  await onSuccess?.();

  return result as T;
}
