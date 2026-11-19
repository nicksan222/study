/** @file Authorizes Dropbox and publishes backups in the app folder. */

import { DROPBOX_BACKUP_CALLBACK_PORT } from '@study/contracts';

import { oauthCodeFlow } from './backup-oauth.ts';
import type { BackupHttp } from './backup-oauth.ts';

export function dropbox(call: BackupHttp) {
  return {
    ...oauthCodeFlow(
      {
        authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
        scope: 'files.content.write',
        authorizeFields: { token_access_type: 'offline' },
        callbackPort: DROPBOX_BACKUP_CALLBACK_PORT
      },
      call
    ),
    upload: async (
      accessToken: string,
      name: string,
      bytes: Uint8Array<ArrayBuffer>,
      signal: AbortSignal
    ) => {
      const response = await call(
        'https://content.dropboxapi.com/2/files/upload',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/octet-stream',
            'dropbox-api-arg': JSON.stringify({
              path: '/' + name,
              mode: 'overwrite',
              autorename: false,
              mute: true
            })
          },
          body: bytes,
          signal
        },
        { upload: true }
      );

      await response.body?.cancel();
    }
  };
}
