import { test } from '@study/testing';

import { verifyCloudBackup } from '../cloud-backup.ts';
import { startS3 } from './fixture.ts';

test.server.stable('S3 rotates and round-trips authenticated backups', async ({ expect, rpc }) => {
  await using storage = await startS3();
  const { client, configuration } = storage;

  await verifyCloudBackup(
    { expect, rpc },
    {
      configuration,
      secret: configuration.secretAccessKey,
      keys: async () =>
        (await client.list({ prefix: configuration.prefix + '/' })).contents?.map(
          ({ key }) => key
        ) ?? [],
      read: async (key) => new Uint8Array(await client.file(key).arrayBuffer())
    }
  );
});
