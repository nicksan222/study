/** @file Publishes visible Google Drive backup objects using durable, Drive-issued IDs. */

import { StudyError } from '@study/contracts';
import { Schema } from 'effect';

import { backupJson, oauthCodeFlow } from './backup-oauth.ts';
import type { BackupHttp } from './backup-oauth.ts';

const driveOrigin = 'https://www.googleapis.com';

const drivePath = '/drive/v3/files';

const uploadPath = '/upload' + drivePath;

const type = 'application/octet-stream';

const fileId = Schema.NonEmptyString.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/));

const fileList = Schema.Struct({
  files: Schema.Array(Schema.Struct({ id: fileId })),
  nextPageToken: Schema.optionalKey(Schema.String)
});

const generatedIds = Schema.Struct({ ids: Schema.Array(fileId) });

const marker = 'studyBackupSlot';

function resumableLocation(response: Response) {
  const location = response.headers.get('location');
  const url = location ? URL.parse(location) : null;

  if (
    !url ||
    (url.origin !== driveOrigin && url.origin !== 'https://content.googleapis.com') ||
    url.username ||
    url.password ||
    !url.searchParams.has('upload_id') ||
    (url.pathname !== uploadPath && !url.pathname.startsWith(uploadPath + '/'))
  )
    throw new StudyError('transient', 'Invalid Google Drive upload session');

  return url;
}

function driveQueryValue(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export function googleDrive(call: BackupHttp) {
  const oauth = oauthCodeFlow(
    {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/drive.file',
      authorizeFields: { access_type: 'offline', prompt: 'consent select_account' },
      callbackHost: '127.0.0.1',
      requiresClientSecret: true
    },
    call
  );

  async function find(accessToken: string, name: string, signal: AbortSignal) {
    const value = driveQueryValue(name);
    const url = new URL(drivePath, driveOrigin);

    url.search = new URLSearchParams({
      q: `trashed = false and name = '${value}' and appProperties has { key='${marker}' and value='${value}' }`,
      fields: 'nextPageToken,files(id)',
      spaces: 'drive',
      pageSize: '10'
    }).toString();

    for (let page = 0; page < 20; page++) {
      const response = await call(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal
      });
      const result = await backupJson(response, fileList);

      if (result.files[0]) return result.files[0].id;

      if (!result.nextPageToken) return undefined;

      url.searchParams.set('pageToken', result.nextPageToken);
    }

    throw new StudyError('transient', 'Google Drive backup search was incomplete');
  }

  async function reserve(accessToken: string, signal: AbortSignal) {
    const response = await call(driveOrigin + drivePath + '/generateIds?count=1&space=drive', {
      headers: { authorization: `Bearer ${accessToken}` },
      signal
    });
    const { ids } = await backupJson(response, generatedIds);

    if (!ids[0]) throw new StudyError('transient', 'Google Drive did not reserve a backup file');

    return ids[0];
  }

  async function startUpload(input: {
    id: string;
    name: string;
    accessToken: string;
    length: number;
    signal: AbortSignal;
    create?: boolean;
  }) {
    const { id, name, accessToken, length, signal, create } = input;
    const url = new URL(
      create ? uploadPath : `${uploadPath}/${encodeURIComponent(id)}`,
      driveOrigin
    );
    const headers = new Headers({
      authorization: `Bearer ${accessToken}`,
      'x-upload-content-type': type,
      'x-upload-content-length': String(length)
    });
    const body = create
      ? JSON.stringify({ id, name, appProperties: { [marker]: name } })
      : undefined;

    if (body) headers.set('content-type', 'application/json');

    url.search = 'uploadType=resumable';

    return call(
      url,
      { method: create ? 'POST' : 'PATCH', headers, body, signal },
      { allow: create ? [409] : [404] }
    );
  }

  async function uploadUrl(input: Parameters<typeof startUpload>[0]) {
    const update = await startUpload(input);

    await update.body?.cancel();

    if (update.ok) return resumableLocation(update);

    const create = await startUpload({ ...input, create: true });

    await create.body?.cancel();

    if (create.ok) return resumableLocation(create);

    // A previous attempt can commit between the failed lookup and this create request.
    const committed = await startUpload(input);

    await committed.body?.cancel();

    if (!committed.ok)
      throw new StudyError('transient', 'Google Drive backup is awaiting confirmation');

    return resumableLocation(committed);
  }

  return {
    ...oauth,
    ensureUpload: async (
      accessToken: string,
      name: string,
      currentId: string | undefined,
      signal: AbortSignal
    ) =>
      currentId ?? (await find(accessToken, name, signal)) ?? (await reserve(accessToken, signal)),
    upload: async (
      accessToken: string,
      name: string,
      bytes: Uint8Array<ArrayBuffer>,
      signal: AbortSignal,
      id?: string
    ) => {
      if (!id || !Schema.is(fileId)(id))
        throw new StudyError('config', 'Google Drive backup requires a reserved file ID');

      const url = await uploadUrl({ id, name, accessToken, signal, length: bytes.length });
      const response = await call(
        url,
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': type },
          body: bytes,
          signal
        },
        { upload: true }
      );

      await response.body?.cancel();
    }
  };
}
