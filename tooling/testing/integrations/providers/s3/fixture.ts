/** Runs authenticated S3 over HTTPS inside the network-isolated provider test container. */

import { testPolicy } from '@study/testing';
import { pollUntil, runTestEffect } from '@study/testing/effect';
import { spawnScopedProcess } from '@study/testing/process';
import { createTestResources, temporaryDirectory } from '@study/testing/resources';
import { S3Client } from 'bun';
import { Effect } from 'effect';

import { fs, path, run } from '#tooling/testing/integrations/filesystem';

const installed = '/opt/study-s3';

function unusedPort() {
  const socket = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = socket.port;

  socket.stop();

  return port;
}

async function createBucket(
  directory: string,
  ca: string,
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string
) {
  const rc = async (args: readonly string[]) => {
    await using child = spawnScopedProcess([path.join(installed, 'rc'), ...args], {
      env: { ...process.env, HOME: directory },
      stdout: 'ignore',
      stderr: 'pipe'
    });
    const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    if (status !== 0) throw new Error(`RustFS setup command failed: ${error}`);
  };

  await rc([
    'alias',
    'set',
    'study',
    endpoint,
    accessKeyId,
    secretAccessKey,
    '--bucket-lookup',
    'path',
    '--ca-bundle',
    ca
  ]);
  await rc(['bucket', 'create', `study/${bucket}`]);
}

export async function startS3() {
  const tls = process.env.STUDY_S3_TLS_DIR;

  if (process.env.STUDY_INTEGRATION_ENVIRONMENT !== 'true' || !tls)
    throw new Error('Run the S3 provider test with bun run integrations:e2e');

  await using setup = createTestResources();
  const directory = await temporaryDirectory({ prefix: 'study-s3-' });

  setup.defer(() => directory[Symbol.asyncDispose]());
  const address = `127.0.0.1:${unusedPort()}`;
  const endpoint = `https://${address}`;
  const bucket = 'study-backups';
  const region = 'us-east-1';
  const accessKeyId = 'study-' + crypto.randomUUID().slice(0, 13);
  const secretAccessKey = crypto.randomUUID();
  const log = Bun.file(path.join(directory.path, 'rustfs.log'));
  const volume = path.join(directory.path, 'objects');

  await run(fs.makeDirectory(volume));
  const rustfs = spawnScopedProcess([path.join(installed, 'rustfs'), 'server', volume], {
    env: {
      ...process.env,
      RUSTFS_ADDRESS: address,
      RUSTFS_TLS_PATH: tls,
      RUSTFS_CONSOLE_ENABLE: 'false',
      RUSTFS_ACCESS_KEY: accessKeyId,
      RUSTFS_SECRET_KEY: secretAccessKey
    },
    stdout: log,
    stderr: log
  });

  setup.defer(() => rustfs[Symbol.asyncDispose]());

  try {
    await runTestEffect(
      pollUntil(
        Effect.tryPromise({
          try: async (signal) => {
            if (rustfs.exitCode !== null) throw new Error('RustFS exited during startup');

            const response = await fetch(endpoint + '/health/ready', { signal }).catch(
              () => undefined
            );

            await response?.body?.cancel();

            return response?.ok ?? false;
          },
          catch: (cause) => cause
        }),
        Boolean,
        { attempts: 100, interval: '100 millis', message: 'RustFS did not become ready' }
      ),
      { timeout: testPolicy.processStartupTimeout }
    );
    await createBucket(
      directory.path,
      path.join(tls, 'ca.pem'),
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket
    );
    const configuration = {
      kind: 's3',
      endpoint,
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      prefix: 'Study backups'
    } as const;
    const client = new S3Client({ endpoint, bucket, region, accessKeyId, secretAccessKey });
    const resources = setup.move();

    return { configuration, client, [Symbol.asyncDispose]: resources.close };
  } catch (error) {
    await rustfs[Symbol.asyncDispose]();
    const report = path.resolve('tooling/test-results/integrations');

    await run(fs.makeDirectory(report, { recursive: true }));

    if (await log.exists()) await Bun.write(path.join(report, 'rustfs.log'), log);

    throw error;
  }
}
