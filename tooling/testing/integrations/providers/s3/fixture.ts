/** Starts an isolated RustFS S3 endpoint and provisions its bucket with the AWS SDK. */

import { CreateBucketCommand, S3Client as AwsS3Client } from '@aws-sdk/client-s3';
import { createTestResources } from '@study/testing/resources';
import { S3Client } from 'bun';

import { CloudContainer, cloudTls, httpsReady, startCloudContainer } from '../cloud-container.ts';

const image =
  'rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74';

export async function startS3() {
  const tls = cloudTls();
  const port = 9000;
  const bucket = 'study-backups';
  const region = 'us-east-1';
  const accessKeyId = 'study-' + crypto.randomUUID().slice(0, 13);
  const secretAccessKey = crypto.randomUUID();

  await using setup = createTestResources();
  const storage = await startCloudContainer(
    'rustfs',
    new CloudContainer(image, port)
      .withEntrypoint(['/usr/bin/rustfs'])
      .withCommand(['server', '/tmp/objects'])
      .withTmpFs({ '/tmp/objects': 'rw,mode=1777' })
      .withEnvironment({
        HOME: '/tmp',
        RUSTFS_ADDRESS: `0.0.0.0:${port}`,
        RUSTFS_TLS_PATH: '/tmp/study-tls',
        RUSTFS_CONSOLE_ENABLE: 'false',
        RUSTFS_OBS_LOGGER_LEVEL: 'info',
        RUSTFS_ACCESS_KEY: accessKeyId,
        RUSTFS_SECRET_KEY: secretAccessKey
      })
      .withUser('0')
      .withBindMounts([tls])
      .withWaitStrategy(httpsReady(port, '/health/ready', 200))
  );

  setup.defer(() => storage[Symbol.asyncDispose]());
  const configuration = {
    kind: 's3',
    endpoint: storage.endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    prefix: 'Study backups'
  } as const;
  const provisioner = new AwsS3Client({
    endpoint: configuration.endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true
  });

  try {
    await provisioner.send(new CreateBucketCommand({ Bucket: bucket }));
  } finally {
    provisioner.destroy();
  }

  const client = new S3Client(configuration);
  const resources = setup.move();

  return { configuration, client, [Symbol.asyncDispose]: resources.close };
}
