/** Creates a promise gate using the constructor supported by older WebKit versions. */
export function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });

  return { promise, resolve, reject };
}
