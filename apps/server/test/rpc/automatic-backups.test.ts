import { MAX_AUTOMATIC_BACKUPS } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Option, Result, Stream } from 'effect';

import { fileSystem, nativePaths, runFileSystemPromise } from '#server/platform/filesystem/index';
import { acceptance, backupFixture, createPage, packet } from '#testing/managed-backups';

test.server.stable(
  'rotates portable folder backups independently of manual backups after reopening',
  async ({ expect }) => {
    const fixture = await backupFixture();
    const fs = await fileSystem;
    const directory = nativePaths.join(fixture.location.dir, 'synced');
    const disconnected = nativePaths.join(fixture.location.dir, 'disconnected');

    try {
      await runFileSystemPromise(fs.makeDirectory(directory));
      await createPage(fixture.app);
      const run = () => fixture.app.nativeRuntime;
      let system = await fixture.api();

      await run().runPromise(system.configureAutomaticBackup({ kind: 'folder', path: directory }));
      await run().runPromise(system.runAutomaticBackup());
      await fixture.reopen();
      system = await fixture.api();

      for (let slot = 0; slot < MAX_AUTOMATIC_BACKUPS; slot++)
        await run().runPromise(system.runAutomaticBackup());

      const files = (await runFileSystemPromise(fs.readDirectory(directory))).filter((name) =>
        name.endsWith('.studybackup')
      );

      expect(files).toHaveLength(MAX_AUTOMATIC_BACKUPS);
      expect(await run().runPromise(system.backups())).toEqual([]);
      const raw = await Bun.file(nativePaths.join(directory, files[0]!)).arrayBuffer();
      const archive = packet(Buffer.from(raw));

      expect(archive.manifest.scope.pages).toBe(1);
      expect(archive.sqlite.includes(directory)).toBe(false);
      const imported = await run().runPromise(
        system.importBackup({ bytes: Buffer.from(raw).toString('base64') })
      );

      expect(imported.scope.pages).toBe(1);
      const previous = await run().runPromise(system.automaticBackup());

      expect(previous.lastSuccessAtMs).toBeGreaterThan(0);
      const nextSlot = files.find((name) => name.endsWith('-2.studybackup'))!;
      const marker = nativePaths.join(directory, nextSlot + '.writing');

      await runFileSystemPromise(fs.writeFileString(marker, 'unrelated file'));
      await runFileSystemPromise(fs.rename(directory, disconnected));
      await expect(run().runPromise(system.runAutomaticBackup())).rejects.toBeDefined();
      const failure = await run().runPromise(system.automaticBackup());

      expect(failure.lastSuccessAtMs).toBe(previous.lastSuccessAtMs);
      expect(failure.lastFailure).toBeTruthy();
      await runFileSystemPromise(fs.rename(disconnected, directory));
      await run().runPromise(system.runAutomaticBackup());
      expect((await run().runPromise(system.automaticBackup())).lastFailure).toBeNull();
      expect(await runFileSystemPromise(fs.readFileString(marker))).toBe('unrelated file');
    } finally {
      await fixture.close();
    }
  }
);

test.server.stable(
  'starts a pending automatic backup after reopening without a backup request',
  async ({ expect, rpc }) => {
    await rpc.runPromise(rpc.client['system.configureAutomaticBackup']({ kind: 'local' }));
    await rpc.reopen();
    const status = await rpc.runPromise(
      rpc.client['system.automaticBackup.live']({}).pipe(
        Stream.filter((frame) => frame._tag === 'Snapshot'),
        Stream.map((frame) => Result.getOrThrow(frame.result)),
        Stream.filter((status) => status.lastSuccessAtMs !== null),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout('10 seconds')
      )
    );

    expect(status.destination).toBe('local');
    expect(status.path).toBeTruthy();
    const fs = await fileSystem;
    const files = await runFileSystemPromise(fs.readDirectory(status.path!));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.studybackup$/);
  }
);

test.server.stable(
  'preserves an accepted restore while automatic backups are pending',
  async ({ expect, rpc }) => {
    const { client, runPromise } = rpc;

    await runPromise(client['system.configureAutomaticBackup']({ kind: 'local' }));
    const backup = await runPromise(client['system.createBackup']({}));
    const preview = await runPromise(client['system.previewRestore']({ id: backup.id }));

    await runPromise(client['system.acceptRestore'](acceptance(preview)));
    await expect(runPromise(client['system.runAutomaticBackup']({}))).rejects.toBeDefined();
    await expect(
      runPromise(client['system.configureAutomaticBackup']({ kind: 'off' }))
    ).rejects.toBeDefined();
    await rpc.reopen();
    const status = await rpc.runPromise(rpc.client['system.restoreStatus']({}));

    expect(status.state).toBe('applied');
  }
);
