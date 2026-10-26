import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);

test('native prototype policy permits the diagram runtime to initialize dates', () => {
  const config = JSON.parse(readFileSync(new URL('../tauri.conf.json', import.meta.url), 'utf8'));
  const context = vm.createContext({});
  // Tauri injects this freeze before application modules. Dayjs, used by Mermaid,
  // initializes its own valueOf method, which cannot shadow a frozen inherited one.
  if (config.app.security.freezePrototype) vm.runInContext('Object.freeze(Object.prototype)', context);
  const dependency = readFileSync(require.resolve('dayjs'), 'utf8');
  vm.runInContext(`"use strict"; ${dependency}`, context);
  assert.equal(vm.runInContext("dayjs('2026-01-01T00:00:00Z').valueOf()", context), Date.UTC(2026, 0, 1));
});
