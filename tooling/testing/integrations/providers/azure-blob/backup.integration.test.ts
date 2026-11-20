import { test } from '@study/testing';

import { verifyCloudBackup } from '../cloud-backup.ts';
import { startAzureBlob } from './fixture.ts';

test.server.stable(
  'Azure Blob rotates and round-trips backups using a container SAS',
  async ({ expect, rpc }) => {
    await using storage = await startAzureBlob();
    const { client, configuration } = storage;

    await verifyCloudBackup(
      { expect, rpc },
      {
        configuration,
        secret: configuration.sas,
        keys: async () => (await Array.fromAsync(client.listBlobsFlat())).map(({ name }) => name),
        read: (key) => client.getBlobClient(key).downloadToBuffer()
      }
    );
  }
);
