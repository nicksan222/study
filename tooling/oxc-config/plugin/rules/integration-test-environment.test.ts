import { test } from '@study/testing';

import { lintFiles } from '../test/utils.ts';

const directory = 'tooling/testing/integrations';

function fixture(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'packages/integrations/src/index.ts': 'export const providers = [];',
    'packages/integrations/src/providers/obsidian/index.ts': 'export const provider = {};',
    [`${directory}/providers.json`]: JSON.stringify({
      obsidian: { executable: '/opt/obsidian/obsidian' }
    }),
    [`${directory}/providers/obsidian/import.integration.test.ts`]: 'export {};',
    [`${directory}/Dockerfile`]:
      'FROM node AS integration-obsidian\nFROM node AS integrations\nCOPY --from=integration-obsidian /opt/obsidian /opt/obsidian\n',
    ...overrides
  };
}

test.stable(
  'integration providers require tests and an installation in the shared image',
  async () => {
    test.expect(await lintFiles(fixture(), 'integration-test-environment', true)).toHaveLength(0);
    const diagnostics = await lintFiles(
      fixture({
        'packages/integrations/src/providers/next/index.ts': 'export const provider = {};',
        [`${directory}/Dockerfile`]: 'FROM node AS integrations\n'
      }),
      'integration-test-environment',
      true
    );

    test
      .expect(diagnostics.map((item) => item.message))
      .toEqual(
        test.expect.arrayContaining([
          test.expect.stringContaining('Provider next must have'),
          test.expect.stringContaining('Install obsidian in stage')
        ])
      );
  }
);

test.stable('provider tests cannot create a separate Docker runtime', async () => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/providers/obsidian/import.integration.test.ts`]:
        "Bun.spawn(['docker', 'run', 'other']);",
      [`${directory}/environment.ts`]: "Bun.spawn(['docker', 'run', 'shared']);"
    }),
    'integration-test-environment',
    true
  );

  test.expect(diagnostics).toHaveLength(1);
  test.expect(diagnostics[0]?.message).toContain('Only testing/integrations/environment.ts');
});

test.stable(
  'integration fixtures reject invalid installation paths and private Dockerfiles',
  async () => {
    const diagnostics = await lintFiles(
      fixture({
        [`${directory}/providers.json`]: JSON.stringify({
          obsidian: { executable: '/usr/bin/obsidian' }
        }),
        [`${directory}/providers/obsidian/Dockerfile`]: 'FROM node',
        [`${directory}/providers/obsidian/import.integration.test.ts`]: 'export {};'
      }),
      'integration-test-environment',
      true
    );

    test
      .expect(diagnostics.map((item) => item.message))
      .toEqual(
        test.expect.arrayContaining([
          test.expect.stringContaining('provider-specific Dockerfiles are forbidden'),
          test.expect.stringContaining('needs an executable installed below /opt/obsidian/')
        ])
      );
  }
);

test.stable.each([
  "const docker = (_args: string[]) => {}; docker(['build', '--file', 'private/Dockerfile']);",
  "Bun.spawn(['docker', 'build', '--file', 'private/Dockerfile', '.']);",
  "Bun.spawn({cmd: ['docker', 'build', '--file', 'private/Dockerfile', '.']});"
])('the shared container builder cannot drift to a different Dockerfile: %s', async (source) => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/environment.ts`]: source
    }),
    'integration-test-environment',
    true
  );

  test.expect(diagnostics).toHaveLength(1);
  test.expect(diagnostics[0]?.message).toContain('tooling/testing/integrations/Dockerfile');
});

test.stable('every provider must have discoverable integration tests', async () => {
  const files = fixture();

  delete files[`${directory}/providers/obsidian/import.integration.test.ts`];
  const diagnostics = await lintFiles(files, 'integration-test-environment', true);

  test
    .expect(diagnostics.map((item) => item.message))
    .toContain('Provider obsidian needs ordinary *.integration.test.ts files.');
});

test.stable.each([
  "Bun.spawn({ cmd: ['docker', 'run', 'other'] });",
  "const command = ['docker', 'run', 'other']; Bun.spawn(command);",
  'Bun.$`docker run other`;'
])('provider tests cannot bypass shared setup with %s', async (source) => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/providers/obsidian/import.integration.test.ts`]: source
    }),
    'integration-test-environment',
    true
  );

  test
    .expect(diagnostics.map((item) => item.message))
    .toContain(
      'Only testing/integrations/environment.ts may launch Docker; use the shared integration environment.'
    );
});

test.stable('Docker command data and ordinary templates are not process launches', async () => {
  const diagnostics = await lintFiles(
    fixture({
      [`${directory}/providers/obsidian/import.integration.test.ts`]:
        "expect(['docker', 'run', 'other']); String.raw`docker run other`;"
    }),
    'integration-test-environment',
    true
  );

  test.expect(diagnostics).toHaveLength(0);
});
