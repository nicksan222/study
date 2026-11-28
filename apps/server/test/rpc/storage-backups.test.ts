import { test } from '@study/testing';

import { System } from '#server/features/system/index';
import { createPage, packet } from '#testing/managed-backups';

test.server.stable(
  'retries a WebDAV backup at the same key and excludes the destination credentials',
  async ({ expect, resources }) => {
    const uploads: { url: string; archive: Buffer }[] = [];
    const published: string[] = [];
    let shouldFail = true;
    const password = 'private-backup-password';
    const app = await resources.openApp({
      fetch: async (input, init) => {
        const request = new Request(input, init);

        expect(request.headers.get('authorization')).toBe('Basic ' + btoa('backup:' + password));

        if (request.method === 'MOVE') {
          published.push(request.headers.get('destination') ?? '');

          return new Response(null, { status: 204 });
        }

        expect(request.method).toBe('PUT');
        uploads.push({ url: request.url, archive: Buffer.from(await request.arrayBuffer()) });

        return new Response(null, { status: shouldFail ? 503 : 201 });
      }
    });
    const run = app.nativeRuntime.runPromise.bind(app.nativeRuntime);
    const backup = await run(System);

    await createPage(app);
    await run(
      backup.configureAutomaticBackup({
        kind: 'webdav',
        url: 'https://nextcloud.test/backups/',
        username: 'backup',
        password
      })
    );
    await expect(
      run(
        backup.configureAutomaticBackup({
          kind: 's3',
          bucket: 'other-bucket',
          region: 'us-east-1',
          prefix: '../invalid',
          accessKeyId: 'key',
          secretAccessKey: 'secret'
        })
      )
    ).rejects.toBeDefined();
    expect((await run(backup.automaticBackup())).destination).toBe('webdav');
    await expect(run(backup.runAutomaticBackup())).rejects.toBeDefined();
    expect((await run(backup.automaticBackup())).lastFailure).toBe('transient');
    shouldFail = false;
    await run(backup.runAutomaticBackup());

    expect(uploads).toHaveLength(2);
    expect(uploads[0]!.url).toBe(uploads[1]!.url);
    expect(published).toHaveLength(1);
    expect(uploads[0]!.url).toBe(published[0]! + '.upload');
    expect(uploads[1]!.archive.includes(password)).toBe(false);
    expect(packet(uploads[1]!.archive).manifest.scope.pages).toBe(1);
    expect((await run(backup.automaticBackup())).lastFailure).toBeNull();
  }
);
