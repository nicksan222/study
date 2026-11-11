import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintFiles } from '../test/utils.ts';

const directory = 'apps/server/test/integrations';

function fixture(overrides: Record<string, string> = {}) {
  return {
    'packages/integrations/src/index.ts': 'export const providers = [];',
    'packages/integrations/src/providers/obsidian/index.ts': 'export const provider = {};',
    [`${directory}/providers.json`]: JSON.stringify({
      obsidian: { scenario: 'providers/obsidian/scenario.ts', executable: '/opt/obsidian/obsidian' }
    }),
    [`${directory}/providers/obsidian/scenario.ts`]: 'export {};',
    [`${directory}/Dockerfile`]:
      'FROM node AS integration-obsidian\nFROM node AS integrations\nCOPY --from=integration-obsidian /opt/obsidian /opt/obsidian\n',
    ...overrides
  };
}

testStable(
  'integration providers require a scenario and an installation in the shared image',
  async () => {
    expect(await lintFiles(fixture(), 'integration-test-environment', true)).toHaveLength(0);
    const diagnostics = await lintFiles(
      fixture({
        'packages/integrations/src/providers/next/index.ts': 'export const provider = {};',
        [`${directory}/Dockerfile`]: 'FROM node AS integrations\n'
      }),
      'integration-test-environment',
      true
    );

    expect(diagnostics.map((item) => item.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Provider next must have'),
        expect.stringContaining('Install obsidian in stage')
      ])
    );
  }
);

testStable('integration scenarios cannot create a separate Testcontainers runtime', async () => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/providers/obsidian/scenario.ts`]:
        "import { GenericContainer } from 'testcontainers'; new GenericContainer('other');",
      [`${directory}/environment.ts`]:
        "import { GenericContainer } from 'testcontainers'; new GenericContainer('shared');"
    }),
    'integration-test-environment',
    true
  );

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.message).toContain('Only test/integrations/environment.ts');
});

testStable('integration fixtures cannot omit scenarios or add private Dockerfiles', async () => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/providers.json`]: JSON.stringify({
        obsidian: { scenario: 'missing.ts', executable: '/usr/bin/obsidian' }
      }),
      [`${directory}/providers/obsidian/Dockerfile`]: 'FROM node'
    }),
    'integration-test-environment',
    true
  );

  expect(diagnostics.map((item) => item.message)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('provider-specific Dockerfiles are forbidden'),
      expect.stringContaining('needs providers/obsidian/scenario.ts'),
      expect.stringContaining('needs an executable installed below /opt/obsidian/')
    ])
  );
});

testStable('the shared container builder cannot drift to a different Dockerfile', async () => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/environment.ts`]:
        "import { GenericContainer } from 'testcontainers'; GenericContainer.fromDockerfile('.', 'private/Dockerfile');"
    }),
    'integration-test-environment',
    true
  );

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.message).toContain('apps/server/test/integrations/Dockerfile');
});
