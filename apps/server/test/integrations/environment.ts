/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds the shared image and fresh disposable integration test containers.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Copies only authored source and removes temporary build inputs.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Testcontainers owns cleanup and no host profile database or vault is mounted.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { GenericContainer, getContainerRuntimeClient } from 'testcontainers';

/** Copy authored input only; never mount a checkout, host dependencies, credentials or test state. */
async function buildContext() {
  const directory = await mkdtemp(join(tmpdir(), 'study-integrations-image-'));
  const files = [
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    'packages',
    'apps/server',
    'tooling',
    'apps/web/package.json',
    'apps/desktop/package.json'
  ];

  try {
    for (const path of files) {
      const target = join(directory, path);

      await mkdir(dirname(target), { recursive: true });
      await cp(resolve(path), target, {
        recursive: true,
        filter: (path) =>
          !path
            .split(sep)
            .some(
              (part) =>
                ['node_modules', 'target', 'dist', '.git'].includes(part) || part.startsWith('.env')
            )
      });
    }

    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });

    throw error;
  }
}

export async function buildIntegrationImage() {
  if (process.env.TESTCONTAINERS_RYUK_DISABLED === 'true')
    throw new Error('Integration tests require Testcontainers resource-reaper cleanup');

  const directory = await buildContext();
  const imageName = `study-integrations-e2e:${randomUUID()}`;

  try {
    const client = await getContainerRuntimeClient();
    const image = await GenericContainer.fromDockerfile(
      directory,
      'apps/server/test/integrations/Dockerfile'
    ).build(imageName);

    return {
      start: (provider: string, executable: string) =>
        image
          .withName(`study-integrations-${randomUUID()}`)
          .withAutoCleanup(true)
          .withAutoRemove(true)
          .withNetworkMode('none')
          .withTmpFs({ '/run/study-test': 'rw,nosuid,nodev,mode=1777,size=256m' })
          .withSharedMemorySize(128 * 1024 * 1024)
          .withEnvironment({
            TMPDIR: '/run/study-test',
            STUDY_INTEGRATION_PROVIDER: provider,
            STUDY_INTEGRATION_EXECUTABLE: executable
          })
          .start(),
      close: () => client.container.dockerode.getImage(imageName).remove({ force: true })
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function integrationContainerRemoved(id: string) {
  const client = await getContainerRuntimeClient();

  try {
    await client.container.inspect(client.container.getById(id));

    return false;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 404
    )
      return true;

    throw error;
  }
}
