import { vi } from 'vite-plus/test';

type MockFactory = NonNullable<Parameters<typeof vi.doMock>[1]>;

export type MockScope = {
  (source: string | URL, factory?: MockFactory): void;
  readonly fn: typeof vi.fn;
  readonly spyOn: typeof vi.spyOn;
  readonly mocked: typeof vi.mocked;
  readonly importActual: typeof vi.importActual;
  readonly importMock: typeof vi.importMock;
  close(): void;
  [Symbol.dispose](): void;
};

export type MockScopeOptions = {
  resolve?: (source: string) => string;
};

function canonicalSource(source: string | URL): string {
  const value = source instanceof URL ? Bun.fileURLToPath(source) : source;

  if (value.startsWith('./') || value.startsWith('../'))
    throw new TypeError(
      `Module mocks require a canonical alias or absolute URL; received "${value}"`
    );

  return value;
}

/** A test-scoped, non-hoisted module-mock registry with exception-safe cleanup. */
export function createMockScope(options: MockScopeOptions = {}): MockScope {
  const cleanup = new DisposableStack();
  const normalize = (source: string | URL) => {
    const value =
      source instanceof URL ? Bun.fileURLToPath(source) : (options.resolve?.(source) ?? source);

    return canonicalSource(value);
  };

  // Mock setup is requested lazily; reset stale subject modules before each scope.
  vi.resetModules();
  cleanup.defer(() => vi.resetModules());
  cleanup.defer(() => vi.restoreAllMocks());
  cleanup.defer(() => vi.unstubAllGlobals());
  cleanup.defer(() => vi.unstubAllEnvs());

  const register = (source: string, factory?: MockFactory) => {
    if (cleanup.disposed) throw new ReferenceError('Mock scope is disposed');

    const key = normalize(source);
    const registration = vi.doMock(key, factory);

    cleanup.use(registration);
  };

  const close = () => cleanup.dispose();
  const scope = Object.assign(
    (source: string | URL, factory?: MockFactory) =>
      register(source instanceof URL ? Bun.fileURLToPath(source) : source, factory),
    {
      fn: vi.fn,
      spyOn: ((...args: Parameters<typeof vi.spyOn>) => {
        if (cleanup.disposed) throw new ReferenceError('Mock scope is disposed');

        const spy = Reflect.apply(vi.spyOn, vi, args) as ReturnType<typeof vi.spyOn>;

        cleanup.defer(() => spy.mockRestore());

        return spy;
      }) as typeof vi.spyOn,
      mocked: vi.mocked,
      importActual: vi.importActual,
      importMock: vi.importMock,
      close,
      [Symbol.dispose]: close
    }
  );

  return scope;
}
