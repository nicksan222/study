import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { buildStoragePolicy } from './build-storage-policy.ts';

const root = new URL('../../', import.meta.url);

const manifest = await Bun.file(new URL('package.json', root)).json();

const cargo = Bun.TOML.parse(await Bun.file(new URL('.cargo/config.toml', root)).text()) as {
  build: { 'target-dir': unknown };
};

const config = {
  scripts: manifest.scripts as Record<string, string>,
  cargoTarget: cargo.build['target-dir'],
  dockerIgnore: await Bun.file(new URL('.devcontainer/Dockerfile.dockerignore', root)).text()
};

testStable(
  'build storage configuration rejects cache bypasses, duplicate targets and broad Docker contexts',
  () => {
    expect(buildStoragePolicy(config)).toEqual([]);
    expect(buildStoragePolicy({ ...config, cargoTarget: 'target' })).toHaveLength(1);
    expect(
      buildStoragePolicy({
        ...config,
        scripts: { ...config.scripts, build: 'bun --bun turbo run build' }
      })
    ).toHaveLength(2);
    expect(
      buildStoragePolicy({ ...config, dockerIgnore: `${config.dockerIgnore}\n!target/**\n` })
    ).toHaveLength(1);
    expect(
      buildStoragePolicy({ ...config, dockerIgnore: config.dockerIgnore.replace('!mise.toml', '') })
    ).toHaveLength(1);
  }
);
