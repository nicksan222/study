import { MAX_AUTOMATIC_BACKUPS } from '@study/contracts';
import { test } from '@study/testing';

import { startS3 } from './fixture.ts';

test.server.stable(
  'S3 stores restorable Study backups and replaces the oldest object at the retention limit',
  async ({ expect, rpc }) => {
    await using storage = await startS3();
    const { client, runPromise } = rpc;
    const listObjects = () => storage.client.list({ prefix: storage.configuration.prefix + '/' });

    await runPromise(client['notes.createNote']({ title: 'Original note' }));
    await runPromise(client['system.configureAutomaticBackup'](storage.configuration));

    for (let slot = 0; slot < MAX_AUTOMATIC_BACKUPS; slot++)
      await runPromise(client['system.runAutomaticBackup']({}));

    const original = (await listObjects()).contents ?? [];
    const oldest = original.find(({ key }) => key.endsWith('-1.studybackup'));

    expect(original).toHaveLength(MAX_AUTOMATIC_BACKUPS);
    expect(oldest).toBeDefined();
    await runPromise(client['notes.createNote']({ title: 'New note' }));
    await runPromise(client['system.runAutomaticBackup']({}));
    const current = (await listObjects()).contents ?? [];

    expect(current.map(({ key }) => key)).toEqual(original.map(({ key }) => key));
    const bytes = Buffer.from(await storage.client.file(oldest!.key).arrayBuffer());

    expect(bytes.includes(storage.configuration.secretAccessKey)).toBe(false);
    const imported = await runPromise(
      client['system.importBackup']({ bytes: bytes.toString('base64') })
    );

    expect(imported.scope.notes).toBe(2);
    expect(imported.credentials).toBe('excluded');
  }
);
