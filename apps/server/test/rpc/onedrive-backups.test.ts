import { test } from '@study/testing';

import { System } from '#server/features/system/index';

test.server.stable(
  'connects OneDrive with PKCE, refreshes offline access, and uploads an app-folder backup',
  async ({ expect, resources: fixture }) => {
    const requests: string[] = [];
    let uploaded: string | undefined;
    const app = await fixture.openApp({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);

        requests.push(url.href);

        if (url.pathname.endsWith('/token')) {
          const form = new URLSearchParams(await request.text());

          if (form.get('grant_type') === 'authorization_code') {
            expect(form.get('code')).toBe('accepted');
            expect(form.get('code_verifier')).toBeTruthy();
          } else {
            expect(form.get('refresh_token')).toBe('private-token');
          }

          return Response.json({ access_token: 'access', refresh_token: 'private-token' });
        }

        expect(request.headers.get('authorization')).toBe('Bearer access');

        if (url.pathname.endsWith('/approot')) return Response.json({ id: 'backup-folder' });

        expect(url.pathname).toContain('/items/backup-folder:/Study-');
        expect(request.method).toBe('PUT');
        uploaded = Buffer.from(await request.arrayBuffer()).toString('latin1');

        return Response.json({});
      }
    });

    try {
      const system = await app.nativeRuntime.runPromise(System);
      const clientId = '323ba9ad-5cf6-4fcc-8991-73f0bc3bfd76';
      const { id, url } = await app.nativeRuntime.runPromise(
        system.beginBackupSignIn({ kind: 'onedrive', clientId })
      );
      const authorization = new URL(url);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);

      expect(authorization.searchParams.get('scope')).toBe(
        'Files.ReadWrite.AppFolder offline_access'
      );
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      callback.searchParams.set('code', 'accepted');
      callback.searchParams.set('state', 'wrong');
      expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      expect((await fetch(callback)).status).toBe(200);

      await app.nativeRuntime.runPromise(system.finishBackupSignIn({ id }));
      await app.nativeRuntime.runPromise(system.runAutomaticBackup());

      expect(requests).toHaveLength(4);
      expect(uploaded?.startsWith('STUDYBK1\n')).toBe(true);
      expect(uploaded).not.toContain('private-token');
      expect((await app.nativeRuntime.runPromise(system.automaticBackup())).destination).toBe(
        'onedrive'
      );
    } finally {
      await app.close();
    }
  }
);
