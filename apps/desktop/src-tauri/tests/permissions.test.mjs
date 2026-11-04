import { readFileSync } from 'node:fs';

import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

testStable(
  'every registered native adapter command is granted to the production main window',
  () => {
    const source = readFileSync(new URL('../src/lib.rs', import.meta.url), 'utf8');
    const registered = source
      .match(/generate_handler!\[([\s\S]*?)\]/)[1]
      .split(',')
      .map((command) => command.trim().split('::').at(-1))
      .filter(Boolean);
    const permissions = readFileSync(
      new URL('../permissions/desktop.toml', import.meta.url),
      'utf8'
    );
    const grants = new Map(
      [
        ...permissions.matchAll(/identifier\s*=\s*"([^"]+)"\s+commands.allow\s*=\s*\[([^\]]*)\]/g)
      ].map(([, id, commands]) => [
        id,
        [...commands.matchAll(/"([^"]+)"/g)].map(([, command]) => command)
      ])
    );
    const capability = JSON.parse(
      readFileSync(new URL('../capabilities/default.json', import.meta.url), 'utf8')
    );

    assert.ok(capability.windows.includes('main'));
    const allowed = new Set(capability.permissions.flatMap((id) => grants.get(id) ?? []));

    expect(
      registered.filter((command) => !allowed.has(command)),
      'registered adapters must have an explicit enabled production capability'
    ).toStrictEqual([]);
  }
);
