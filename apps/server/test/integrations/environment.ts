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

import { GenericContainer, getContainerRuntimeClient } from 'testcontainers';

import { fs, path, run } from './filesystem.ts';

/** Copy authored input only; never mount a checkout, host dependencies, credentials or test state. */
export async function buildContext(root = process.cwd()) {
  const directory = await run(fs.makeTempDirectory({ prefix: 'study-integrations-image-' }));
  const files = [
    'package.json',
    'bun.lock',
    'vite.config.ts',
    'packages',
    'apps/server',
    'tooling',
    'apps/web/package.json',
    'apps/desktop/package.json'
  ];

  try {
    const copy = async (relative: string): Promise<void> => {
      if (
        relative
          .split('/')
          .some(
            (part) =>
              ['node_modules', 'target', 'dist', '.git'].includes(part) || part.startsWith('.env')
          )
      )
        return;

      const source = path.resolve(root, relative);
      const target = path.join(directory, relative);
      const info = await run(fs.lstat(source));

      if (info.type === 'Directory') {
        await run(fs.makeDirectory(target, { recursive: true }));

        for (const entry of await run(fs.readDirectory(source))) await copy(`${relative}/${entry}`);
      } else {
        await run(fs.makeDirectory(path.dirname(target), { recursive: true }));
        await run(fs.copy(source, target));
      }
    };

    for (const file of files) await copy(file);

    return directory;
  } catch (error) {
    await run(fs.remove(directory, { recursive: true, force: true }));

    throw error;
  }
}

export async function buildIntegrationImage() {
  if (!process.versions.bun) throw new Error('Integration tests require the Bun runtime');

  if (process.env.TESTCONTAINERS_RYUK_DISABLED === 'true')
    throw new Error('Integration tests require Testcontainers resource-reaper cleanup');

  const directory = await buildContext();
  const imageName = `study-integrations-e2e:${crypto.randomUUID()}`;

  try {
    const client = await getContainerRuntimeClient();
    const image = await GenericContainer.fromDockerfile(
      directory,
      'apps/server/test/integrations/Dockerfile'
    ).build(imageName);

    return {
      start: (provider: string, executable: string) =>
        image
          .withName(`study-integrations-${crypto.randomUUID()}`)
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
    await run(fs.remove(directory, { recursive: true, force: true }));
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
