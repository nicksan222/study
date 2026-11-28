import { test } from '@study/testing';

import { oauthCodeFlow } from './backup-oauth.ts';
import { backupOAuth } from './file-backup-providers.ts';

const name = 'Study-installation-1.studybackup';

const bytes = new Uint8Array([1, 2, 3]);

test.server.stable(
  'fixed-port backup sign-in reports an occupied callback port',
  async ({ expect }) => {
    const occupied = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const oauth = oauthCodeFlow(
      {
        authorizeUrl: 'https://login.example.test/authorize',
        tokenUrl: 'https://login.example.test/token',
        scope: 'backup.write',
        callbackPort: occupied.port!
      },
      async () => new Response()
    );

    try {
      expect(() => oauth.begin('backup-client')).toThrow(
        expect.objectContaining({
          kind: 'config',
          message: `Backup sign-in port ${occupied.port} is in use`
        })
      );
    } finally {
      await occupied.stop(true);
    }
  }
);

test.server.stable(
  'Google Drive replaces the reserved object after an ambiguous resumable upload',
  async ({ expect }) => {
    let remote: string | undefined;
    let generated = 0;
    let creations = 0;
    const google = backupOAuth(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      expect(request.headers.get('authorization')).toBe('Bearer drive-token');

      if (url.pathname.endsWith('/generateIds')) {
        generated++;

        return Response.json({ ids: ['reserved'] });
      }

      if (url.searchParams.has('q')) {
        expect(url.searchParams.get('q')).toContain(name);

        return Response.json({ files: remote ? [{ id: remote }] : [] });
      }

      if (request.method === 'POST') {
        creations++;
        const metadata = await request.json();

        expect(metadata).toMatchObject({ name, id: 'reserved' });
      }

      if (request.method === 'PATCH' && !remote) return new Response(null, { status: 404 });

      if (request.method === 'PUT') {
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);

        if (!remote) {
          remote = 'reserved';

          throw new Error('Connection ended after storing the object');
        }

        return Response.json({ id: remote });
      }

      expect(url.searchParams.get('uploadType')).toBe('resumable');

      return new Response(null, {
        headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' }
      });
    })['google-drive'];
    const signal = new AbortController().signal;
    const id = await google.ensureUpload('drive-token', name, undefined, signal);

    await expect(google.upload('drive-token', name, bytes, signal, id)).rejects.toBeDefined();
    expect(await google.ensureUpload('drive-token', name, id, signal)).toBe(id);
    await google.upload('drive-token', name, bytes, signal, id);
    expect(await google.ensureUpload('drive-token', name, undefined, signal)).toBe(id);
    expect(generated).toBe(1);
    expect(creations).toBe(1);
  }
);

test.server.stable(
  'Dropbox asks for offline app-folder writes and overwrites its deterministic slot',
  async ({ expect }) => {
    const dropbox = backupOAuth(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname.endsWith('/token')) {
        const form = new URLSearchParams(await request.text());

        expect(form.get('client_id')).toBe('dropbox-app');
        expect(form.get('grant_type')).toBe('authorization_code');
        expect(form.get('code_verifier')).toBeTruthy();

        return Response.json({ access_token: 'access', refresh_token: 'offline' });
      }

      expect(url.href).toBe('https://content.dropboxapi.com/2/files/upload');
      expect(request.headers.get('authorization')).toBe('Bearer access');
      const args = JSON.parse(request.headers.get('dropbox-api-arg')!);

      expect(args).toMatchObject({ path: '/' + name, mode: 'overwrite', autorename: false });
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);

      return Response.json({});
    }).dropbox;
    const signIn = dropbox.begin('dropbox-app');

    try {
      const authorization = new URL(signIn.url);
      const redirect = authorization.searchParams.get('redirect_uri')!;

      expect(redirect).toBe('http://localhost:42819/study-backup');
      expect(authorization.searchParams.get('scope')).toBe('files.content.write');
      expect(authorization.searchParams.get('token_access_type')).toBe('offline');
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      const callback = new URL(redirect);

      callback.searchParams.set('code', 'authorized');
      callback.searchParams.set('state', 'wrong');
      expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      expect((await fetch(callback)).status).toBe(200);
      expect((await fetch(callback)).status).toBe(400);
      const signal = new AbortController().signal;

      expect(await signIn.finish(signal)).toBe('offline');
      await dropbox.upload('access', name, bytes, signal);
    } finally {
      signIn.close();
    }
  }
);

test.server.stable(
  'Google Desktop uses the client secret only for the PKCE token exchange and refresh',
  async ({ expect }) => {
    const requests: URLSearchParams[] = [];
    const google = backupOAuth(async (input, init) => {
      const request = new Request(input, init);

      expect(request.url).toBe('https://oauth2.googleapis.com/token');
      requests.push(new URLSearchParams(await request.text()));

      return Response.json({ access_token: 'active-token', refresh_token: 'refresh-token' });
    })['google-drive'];
    const clientSecret = 'private-desktop-client-secret';
    const signIn = google.begin('example.apps.googleusercontent.com', clientSecret);

    try {
      const authorization = new URL(signIn.url);

      expect(authorization.href).not.toContain(clientSecret);
      expect(authorization.searchParams.get('scope')).toBe(
        'https://www.googleapis.com/auth/drive.file'
      );
      expect(authorization.searchParams.get('access_type')).toBe('offline');
      const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
      const callback = new URL(redirect);

      expect(redirect.hostname).toBe('127.0.0.1');
      callback.searchParams.set('code', 'authorized');
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      expect((await fetch(callback)).status).toBe(200);
      const signal = new AbortController().signal;

      expect(await signIn.finish(signal)).toBe('refresh-token');
      expect(
        await google.refresh(
          'example.apps.googleusercontent.com',
          'refresh-token',
          signal,
          clientSecret
        )
      ).toMatchObject({ access_token: 'active-token' });

      expect(requests).toHaveLength(2);
      expect(requests[0]?.get('client_secret')).toBe(clientSecret);
      expect(requests[0]?.get('redirect_uri')).toBe(redirect.href);
      expect(requests[0]?.get('code_verifier')).toBeTruthy();
      expect(requests[1]?.get('client_secret')).toBe(clientSecret);
      expect(requests[1]?.get('refresh_token')).toBe('refresh-token');
    } finally {
      signIn.close();
    }
  }
);
