import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';

export const MAX_AUTOMATIC_BACKUPS = 7;

export const DROPBOX_BACKUP_CALLBACK_PORT = 42819;

const credential = Schema.String.check(Schema.isBetweenLength(1, 4096));

const httpsAddress = Schema.String.check(
  Schema.isBetweenLength(1, 4096),
  Schema.makeFilter((text) => {
    if (!URL.canParse(text) || text.includes('?') || text.includes('#')) return false;

    const url = new URL(text);

    return url.protocol === 'https:' && url.username === '' && url.password === '';
  })
);

const prefix = Schema.String.check(Schema.isMaxLength(768));

export const automaticBackupFileDestinationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({
    kind: Schema.Literal('folder'),
    path: Schema.String.check(Schema.isBetweenLength(1, 4096))
  })
]);

export const storageBackupDestinationSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('s3'),
    endpoint: Schema.optionalKey(httpsAddress),
    region: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/)),
    bucket: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)),
    prefix: Schema.optionalKey(prefix),
    accessKeyId: credential,
    secretAccessKey: credential
  }),
  Schema.Struct({
    kind: Schema.Literal('webdav'),
    url: httpsAddress,
    username: Schema.String.check(Schema.isPattern(/^[^:\r\n]{1,512}$/)),
    password: credential
  }),
  Schema.Struct({
    kind: Schema.Literal('azure-blob'),
    url: httpsAddress,
    sas: credential,
    prefix: Schema.optionalKey(prefix)
  })
]);

export const automaticBackupConfigurationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('off') }),
  automaticBackupFileDestinationSchema,
  storageBackupDestinationSchema
]);

const oneDrive = Schema.Struct({
  kind: Schema.Literal('onedrive'),
  clientId: Schema.String.check(Schema.isUUID())
});

const googleDrive = Schema.Struct({
  kind: Schema.Literal('google-drive'),
  clientId: credential,
  clientSecret: credential
});

const dropbox = Schema.Struct({
  kind: Schema.Literal('dropbox'),
  clientId: credential
});

export const backupOAuthInputSchema = Schema.Union([oneDrive, googleDrive, dropbox]);

const refresh = Schema.fieldsAssign({ refreshToken: credential });

export const backupOAuthConnectionSchema = Schema.Union([
  oneDrive.pipe(refresh),
  googleDrive.pipe(refresh),
  dropbox.pipe(refresh)
]);

export const backupSignInIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand('BackupSignInId')
);

export const automaticBackupStatusSchema = Schema.Struct({
  destination: Schema.Literals([
    'off',
    'local',
    'folder',
    'onedrive',
    'google-drive',
    'dropbox',
    's3',
    'webdav',
    'azure-blob'
  ]),
  path: Schema.NullOr(Schema.String),
  lastSuccessAtMs: Schema.NullOr(Schema.Int),
  lastFailure: Schema.NullOr(errorKindSchema)
});
