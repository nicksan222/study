/** @file Authorizes OneDrive and publishes backups in the app folder. */

import { Schema } from 'effect';

import { backupJson, oauthCodeFlow } from './backup-oauth.ts';
import type { BackupHttp } from './backup-oauth.ts';

const authority = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

const drive = 'https://graph.microsoft.com/v1.0/me/drive';

const scope = 'Files.ReadWrite.AppFolder offline_access';

const folderIdentity = Schema.Struct({ id: Schema.NonEmptyString });

export function oneDrive(call: BackupHttp) {
  return {
    ...oauthCodeFlow(
      {
        authorizeUrl: authority + '/authorize',
        tokenUrl: authority + '/token',
        scope,
        authorizeFields: { prompt: 'select_account' },
        tokenFields: { scope }
      },
      call
    ),
    upload: async (
      accessToken: string,
      name: string,
      bytes: Uint8Array<ArrayBuffer>,
      signal: AbortSignal
    ) => {
      const authorization = `Bearer ${accessToken}`;
      const folder = await call(drive + '/special/approot', { headers: { authorization }, signal });
      const { id } = await backupJson(folder, folderIdentity);
      const response = await call(
        `${drive}/items/${encodeURIComponent(id)}:/${encodeURIComponent(name)}:/content`,
        {
          method: 'PUT',
          headers: { authorization, 'content-type': 'application/octet-stream' },
          body: bytes,
          signal
        },
        { upload: true }
      );

      await response.body?.cancel();
    }
  };
}
