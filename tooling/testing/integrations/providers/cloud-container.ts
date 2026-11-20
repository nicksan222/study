/** Starts test-only HTTPS providers with a private CA and loopback-only published ports. */

import { testPolicy } from '@study/testing';
import { pollUntil, runTestEffect } from '@study/testing/effect';
import { createTestResources } from '@study/testing/resources';
import { Effect } from 'effect';
import { GenericContainer, getContainerRuntimeClient } from 'testcontainers';
import type { BoundPorts, WaitStrategy } from 'testcontainers';

import { fs, path, run } from '../filesystem.ts';

export class CloudContainer extends GenericContainer {
  constructor(
    image: string,
    readonly port: number
  ) {
    super(image);
    this.withExposedPorts(port);
    this.hostConfig.PortBindings![`${port}/tcp`] = [{ HostIp: '127.0.0.1', HostPort: '0' }];
    this.withStartupTimeout(testPolicy.processStartupTimeout);
  }
}

export function httpsReady(port: number, route: string, status: number): WaitStrategy {
  let timeout: number = testPolicy.processStartupTimeout;

  return {
    withStartupTimeout(ms) {
      timeout = ms;

      return this;
    },
    isStartupTimeoutSet: () => true,
    getStartupTimeout: () => timeout,
    async waitUntilReady(_container, ports: BoundPorts) {
      const endpoint = `https://127.0.0.1:${ports.getBinding(port)}${route}`;

      await runTestEffect(
        pollUntil(
          Effect.tryPromise(async (signal) => {
            const response = await fetch(endpoint, { signal }).catch(() => undefined);

            await response?.body?.cancel();

            return response?.status === status;
          }),
          Boolean,
          {
            attempts: 100,
            interval: '100 millis',
            message: `Provider did not become ready at ${route}`
          }
        ),
        { timeout }
      );
    }
  };
}

export function cloudTls() {
  const tls = process.env.STUDY_CLOUD_TLS_DIR;

  if (process.env.STUDY_CLOUD_INTEGRATION_ENVIRONMENT !== 'true' || !tls)
    throw new Error('Run cloud provider tests with bun run integrations:e2e');

  return { source: tls, target: '/tmp/study-tls', mode: 'ro' as const };
}

export async function startCloudContainer(name: string, definition: CloudContainer) {
  const logs = path.resolve('tooling/test-results/integrations');
  const containerName = `study-${name}-${crypto.randomUUID()}`;

  await run(fs.makeDirectory(logs, { recursive: true }));
  await using setup = createTestResources();
  const log = Bun.file(path.join(logs, `${name}.log`)).writer();

  setup.defer(() => log.end());
  const runtime = await getContainerRuntimeClient();

  setup.defer(async () => {
    try {
      // A daemon may acknowledge stop before the provider has released its volumes.
      await runtime.container.getById(containerName).remove({ force: true, v: true });
    } catch (error) {
      if (!(error instanceof Error && 'statusCode' in error && error.statusCode === 404))
        throw error;
    }
  });
  const container = await definition
    .withName(containerName)
    .withLogConsumer((stream) => {
      stream.on('data', (chunk: Buffer) => log.write(chunk));
    })
    .start();
  const resources = setup.move();

  return {
    endpoint: `https://127.0.0.1:${container.getMappedPort(definition.port)}`,
    [Symbol.asyncDispose]: resources.close
  };
}
