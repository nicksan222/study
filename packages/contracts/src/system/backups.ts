import { Schema } from 'effect';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

export const MAX_MANAGED_BACKUPS = 8;

const uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
);

export const backupIdSchema = uuid.pipe(Schema.brand('BackupId'));

export type BackupId = typeof backupIdSchema.Type;

export const restoreTokenSchema = uuid.pipe(Schema.brand('RestoreToken'));

export const backupDigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export const backupScopeSchema = Schema.Struct({
  materials: Schema.Int,
  versions: Schema.Int,
  documents: Schema.Int,
  documentVersions: Schema.Int,
  extractions: Schema.Int,
  documentRetirements: Schema.Int,
  sources: Schema.Int,
  collections: Schema.Int,
  sessions: Schema.Int,
  annotations: Schema.Int,
  quizAttempts: Schema.Int,
  cardReviews: Schema.Int,
  practiceSlots: Schema.Int,
  tombstones: Schema.Int,
  historyPrunes: Schema.Int,
  prunedVersions: Schema.Int
});

export const backupManifestSchema = Schema.Struct({
  format: Schema.Literal('study-managed-backup'),
  version: Schema.Literal(1),
  id: backupIdSchema,
  createdAtMs: Schema.Int,
  schema: backupDigestSchema,
  sha256: backupDigestSchema,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_BACKUP_BYTES })),
  scope: backupScopeSchema,
  credentials: Schema.Literal('excluded'),
  nativeWork: Schema.Literal('retired'),
  compatibility: Schema.Literal('exact-schema')
});

export type BackupManifest = typeof backupManifestSchema.Type;

export const restorePreviewSchema = Schema.Struct({
  token: restoreTokenSchema,
  backup: backupManifestSchema,
  current: backupScopeSchema,
  target: backupDigestSchema,
  requiresRestart: Schema.Literal(true),
  requiresSignIn: Schema.Literal(true),
  replacesAllContent: Schema.Literal(true),
  backupRetainsDeletedContent: Schema.Literal(true),
  blockedByCurrentBarriers: Schema.Boolean
});

export type RestorePreview = typeof restorePreviewSchema.Type;

export const restoreStatusSchema = Schema.Struct({
  state: Schema.Literals([
    'idle',
    'restart-required',
    'applied',
    'target-changed',
    'activation-failed'
  ]),
  backupId: Schema.NullOr(backupIdSchema),
  recoveryCopy: Schema.Boolean
});

export const backupInputSchema = Schema.Struct({ id: backupIdSchema });

// Byte transport only; clients never choose a server filesystem path.

export const backupBytesSchema = Schema.String.check(
  Schema.isMaxLength(Math.ceil((MAX_BACKUP_BYTES + 16384) / 3) * 4)
);

export const acceptRestoreSchema = Schema.Struct({
  token: restoreTokenSchema,
  backupId: backupIdSchema,
  sha256: backupDigestSchema,
  target: backupDigestSchema,
  acknowledgeReplacement: Schema.Literal(true)
});
