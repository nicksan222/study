const registry = Symbol.for('study.testing.api');

type Api = Record<PropertyKey, unknown>;

/** Runner setup installs its own typed fixtures before collecting tests. */
export function installTestApi(api: object): void {
  Reflect.set(globalThis, registry, api);
}

/** Importing policy in configs or scripts never loads a test runner. */
export function createTestFacade<T extends object>(): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const api = Reflect.get(globalThis, registry) as Api | undefined;

      if (!api) throw new Error('Testing API is unavailable: configure the shared runner setup');

      if (!Reflect.has(api, property))
        throw new Error(`Testing API namespace is unavailable: ${String(property)}`);

      return Reflect.get(api, property);
    }
  });
}
