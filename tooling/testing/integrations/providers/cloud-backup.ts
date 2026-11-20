/** Exercises the same Study backup lifecycle against each real cloud storage peer. */

import { MAX_AUTOMATIC_BACKUPS } from '@study/contracts';
import type { storageBackupDestinationSchema } from '@study/contracts';
import type { test } from '@study/testing';

type StoragePeer = {
  configuration: typeof storageBackupDestinationSchema.Type;
  keys(): Promise<string[]>;
  read(key: string): Promise<Uint8Array>;
  secret: string;
};

export async function verifyCloudBackup(
  { expect, rpc }: Pick<test.server.Context, 'expect' | 'rpc'>,
  peer: StoragePeer
) {
  const { client, runPromise } = rpc;

  await runPromise(client['notes.createNote']({ title: 'Original note' }));
  await runPromise(client['system.configureAutomaticBackup'](peer.configuration));

  for (let slot = 0; slot < MAX_AUTOMATIC_BACKUPS; slot++)
    await runPromise(client['system.runAutomaticBackup']({}));

  const original = (await peer.keys()).sort();
  const oldest = original.find((key) => key.endsWith('-1.studybackup'));

  expect(original).toHaveLength(MAX_AUTOMATIC_BACKUPS);
  expect(oldest).toBeDefined();
  await runPromise(client['notes.createNote']({ title: 'New note' }));
  await runPromise(client['system.runAutomaticBackup']({}));
  expect((await peer.keys()).sort()).toEqual(original);

  const bytes = Buffer.from(await peer.read(oldest!));

  expect(bytes.includes(peer.secret)).toBe(false);
  const imported = await runPromise(
    client['system.importBackup']({ bytes: bytes.toString('base64') })
  );

  expect(imported.scope.notes).toBe(2);
  expect(imported.credentials).toBe('excluded');
  await runPromise(client['notes.createNote']({ title: 'Created after the backup' }));
  const preview = await runPromise(client['system.previewRestore']({ id: imported.id }));

  expect(preview.current.notes).toBe(3);
  await runPromise(
    client['system.acceptRestore']({
      token: preview.token,
      backupId: imported.id,
      sha256: imported.sha256,
      target: preview.target,
      acknowledgeReplacement: true
    })
  );
  await rpc.reopen();
  expect(await rpc.runPromise(rpc.client['system.restoreStatus']({}))).toMatchObject({
    state: 'applied'
  });
  const restored = await rpc.runPromise(rpc.client['system.createBackup']({}));

  expect(restored.scope.notes).toBe(2);
}
