/** @file Binds file-service OAuth providers to the same bounded transport. */

import { backupHttp } from './backup-oauth.ts';
import { dropbox } from './dropbox-backup.ts';
import { googleDrive } from './google-drive-backup.ts';
import { oneDrive } from './onedrive.ts';

export function backupOAuth(request?: Parameters<typeof backupHttp>[0]) {
  const call = backupHttp(request);

  return { onedrive: oneDrive(call), 'google-drive': googleDrive(call), dropbox: dropbox(call) };
}
