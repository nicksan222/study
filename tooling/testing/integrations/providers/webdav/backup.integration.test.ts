import { test } from '@study/testing';

import { verifyCloudBackup } from '../cloud-backup.ts';
import { startWebDav } from './fixture.ts';

test.server.stable(
  'WebDAV publishes and replaces restorable backups via MOVE',
  async ({ expect, rpc }) => {
    await using storage = await startWebDav();

    await verifyCloudBackup(
      { expect, rpc },
      { ...storage, secret: storage.configuration.password }
    );
  }
);
