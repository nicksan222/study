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

type MockScopeOptions = {
  resolve?: (source: string) => string;
};

/** A test-scoped, non-hoisted module-mock registry with exception-safe cleanup. */
export function createMockScope(options: MockScopeOptions = {}): MockScope {
  const cleanup = new DisposableStack();

  // Mock setup is requested lazily; reset stale subject modules before each scope.
  vi.resetModules();
  cleanup.defer(() => vi.resetModules());
  cleanup.defer(() => vi.restoreAllMocks());
  cleanup.defer(() => vi.unstubAllGlobals());
  cleanup.defer(() => vi.unstubAllEnvs());

  const register = (source: string | URL, factory?: MockFactory) => {
    const value = source instanceof URL ? Bun.fileURLToPath(source) : source;

    if (cleanup.disposed) throw new ReferenceError('Mock scope is disposed');

    const key = options.resolve?.(value) ?? value;

    if (key.startsWith('./') || key.startsWith('../'))
      throw new TypeError(
        `Module mocks require a canonical alias or absolute URL; received "${key}"`
      );

    const registration = vi.doMock(key, factory);

    cleanup.use(registration);
  };

  const close = () => cleanup.dispose();
  const scope = Object.assign(register, {
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
  });

  return scope;
}
