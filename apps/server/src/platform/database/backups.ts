/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Owns private bounded backup artifacts and recoverable SQLite activation at         │
 * │ controlled application startup.                                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates artifact bytes and coordinates staging, replacement and explicit recovery    │
 * │   retention.                                                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime injects feature policy; storage never replaces an open application database      │
 * │ connection.                                                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';

import { StudyError } from '@study/contracts/errors';
import {
  MAX_BACKUP_BYTES,
  MAX_MANAGED_BACKUPS,
  backupIdSchema,
  backupManifestSchema,
  restoreTokenSchema,
  restoreStatusSchema,
  backupDigestSchema,
  acceptRestoreSchema
} from '@study/contracts/system/backups';
import type { BackupId, BackupManifest, RestorePreview } from '@study/contracts/system/backups';
import type { backupScopeSchema } from '@study/contracts/system/backups';
import { Db } from '@study/db';
import type { Clock } from 'effect';
import { Context, Schema } from 'effect';

import { liveClock } from '#server/platform/time/index';

type Scope = typeof backupScopeSchema.Type;

export interface SnapshotPolicy {
  prepare(db: Db): Promise<void>;
  validate(db: Db): Promise<void>;
  inspect(db: Db): Promise<{ scope: Scope; identity: string }>;
  blocksRestore(scope: Scope): boolean;
}

const journalSchema = Schema.Struct({
  state: Schema.Literals(['restart-required', 'applied', 'target-changed', 'activation-failed']),
  token: restoreTokenSchema,
  backupId: backupIdSchema,
  target: backupDigestSchema,
  restored: backupDigestSchema,
  sha256: backupDigestSchema
});

type Journal = typeof journalSchema.Type;

const magic = Buffer.from('STUDYBK1\n');

const maxArtifact = MAX_BACKUP_BYTES + 16384;

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const invalid = () => new StudyError('invalid_input', 'Invalid or incompatible backup');

const conflict = () =>
  new StudyError('invalid_input', 'Backup operation conflicts with current state');

function syncFile(path: string) {
  const fd = openSync(path, 'r');

  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path: string) {
  if (process.platform !== 'win32') syncFile(path);
}

function removeDatabase(path: string) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
}

function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });

  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw invalid();

  chmodSync(path, 0o700);
}

function boundedRead(path: string, maximum: number) {
  const stat = lstatSync(path);

  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || stat.size < 1)
    throw invalid();

  return readFileSync(path);
}

function durableWrite(path: string, bytes: Uint8Array | string) {
  const temporary = path + '.writing';

  rmSync(temporary, { force: true });
  writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  syncFile(temporary);
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

function encode(manifest: BackupManifest, bytes: Uint8Array) {
  const json = Buffer.from(JSON.stringify(manifest));

  const size = Buffer.alloc(4);

  size.writeUInt32BE(json.length);

  return Buffer.concat([magic, size, json, bytes]);
}

function decode(bytes: Buffer) {
  if (
    bytes.length > maxArtifact ||
    bytes.length < magic.length + 4 ||
    !bytes.subarray(0, magic.length).equals(magic)
  )
    throw invalid();

  const size = bytes.readUInt32BE(magic.length);

  const start = magic.length + 4;

  if (size > 8192 || start + size >= bytes.length) throw invalid();

  const manifest = Schema.decodeUnknownSync(backupManifestSchema)(
    JSON.parse(bytes.subarray(start, start + size).toString('utf8'))
  );

  const sqlite = bytes.subarray(start + size);

  if (sqlite.length !== manifest.bytes || digest(sqlite) !== manifest.sha256) throw invalid();

  return { manifest, sqlite };
}

function readJournal(root: string): Journal | undefined {
  const path = join(root, 'restore.json');

  return existsSync(path)
    ? Schema.decodeUnknownSync(journalSchema)(JSON.parse(boundedRead(path, 4096).toString('utf8')))
    : undefined;
}

function cleanInterrupted(root: string) {
  privateDirectory(root);
  removeDatabase(join(root, 'scratch.sqlite'));

  for (const name of readdirSync(root)) {
    if (
      name.endsWith('.studybackup.writing') &&
      Schema.is(backupIdSchema)(name.slice(0, -'.studybackup.writing'.length))
    )
      rmSync(join(root, name), { force: true });
  }

  for (const name of ['restore.sqlite.writing', 'restore.json.writing'])
    rmSync(join(root, name), { force: true });
}

/** One owner per App; all public operations share its overlap fence. */

export class ManagedBackups {
  readonly root: string;
  private busy = false;
  private closed = false;
  private active: Promise<void> | undefined;
  private preview: RestorePreview | undefined;

  constructor(
    private readonly db: Db,
    private readonly policy: SnapshotPolicy,
    private readonly clock: Clock.Clock = liveClock()
  ) {
    this.root = db.path + '.backups';
  }

  private initialize() {
    if (this.db.path === ':memory:')
      throw new StudyError('unsupported', 'Backups require a file database');

    privateDirectory(this.root);
  }

  private artifact(id: BackupId) {
    return join(this.root, Schema.decodeUnknownSync(backupIdSchema)(id) + '.studybackup');
  }

  private journal(): Journal | undefined {
    return readJournal(this.root);
  }

  private writeJournal(value: Journal) {
    durableWrite(
      join(this.root, 'restore.json'),
      JSON.stringify(Schema.decodeUnknownSync(journalSchema)(value))
    );
  }

  private async exclusive<A>(work: () => Promise<A> | A): Promise<A> {
    if (this.busy || this.closed) throw conflict();

    this.busy = true;

    let release!: () => void;

    this.active = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      this.initialize();

      return await work();
    } catch (cause) {
      if (cause instanceof StudyError) throw cause;

      throw new StudyError('invalid_input', 'Backup operation failed', { cause });
    } finally {
      this.busy = false;
      this.active = undefined;
      release();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.active;
  }

  private assertMutable() {
    if (this.journal()?.state === 'restart-required') throw conflict();
  }

  private capacity() {
    if (this.names().length >= MAX_MANAGED_BACKUPS) throw conflict();
  }

  private names() {
    const names = readdirSync(this.root).filter((name) => name.endsWith('.studybackup'));

    if (names.length > MAX_MANAGED_BACKUPS) throw invalid();

    return names;
  }

  private async validateFile(path: string, manifest?: BackupManifest) {
    const schema = Db.validateSnapshot(path);

    const snapshot = Db.openSnapshot(path);

    try {
      await this.policy.validate(snapshot);

      const { scope, identity } = await this.policy.inspect(snapshot);

      if (
        manifest &&
        (manifest.schema !== schema || JSON.stringify(scope) !== JSON.stringify(manifest.scope))
      )
        throw invalid();

      return { schema, scope, identity };
    } finally {
      snapshot.close();
    }
  }

  private async validatedArtifact(id: BackupId, scratch: string) {
    const artifact = decode(boundedRead(this.artifact(id), maxArtifact));

    if (artifact.manifest.id !== id) throw invalid();

    writeFileSync(scratch, artifact.sqlite, { mode: 0o600, flag: 'wx' });

    const detail = await this.validateFile(scratch, artifact.manifest);

    return { ...artifact, ...detail };
  }

  private async scratch<A>(work: (path: string) => Promise<A> | A): Promise<A> {
    const path = join(this.root, 'scratch.sqlite');

    removeDatabase(path);

    try {
      return await work(path);
    } finally {
      removeDatabase(path);
    }
  }

  create(): Promise<BackupManifest> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        this.assertMutable();
        this.capacity();
        await this.db.snapshot(path, MAX_BACKUP_BYTES);

        if (lstatSync(path).size > MAX_BACKUP_BYTES) throw invalid();

        chmodSync(path, 0o600);

        const snapshot = Db.openSnapshot(path);

        try {
          await this.policy.prepare(snapshot);
          // Rebuild exported pages after credential deletion: no freelist/WAL credential residue.
          snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; VACUUM;');
        } finally {
          snapshot.close();
        }

        const { schema, scope } = await this.validateFile(path);

        const bytes = boundedRead(path, MAX_BACKUP_BYTES);

        const manifest = Schema.decodeUnknownSync(backupManifestSchema)({
          format: 'study-managed-backup',
          version: 1,
          id: randomUUID(),
          createdAtMs: this.clock.currentTimeMillisUnsafe(),
          schema,
          sha256: digest(bytes),
          bytes: bytes.length,
          scope,
          credentials: 'excluded',
          nativeWork: 'retired',
          compatibility: 'exact-schema'
        });

        durableWrite(this.artifact(manifest.id), encode(manifest, bytes));

        return manifest;
      })
    );
  }

  list(): Promise<readonly BackupManifest[]> {
    return this.exclusive(() =>
      this.names()
        .map((name) => {
          const id = Schema.decodeUnknownSync(backupIdSchema)(
            name.slice(0, -'.studybackup'.length)
          );

          const { manifest } = decode(boundedRead(this.artifact(id), maxArtifact));

          if (manifest.id !== id) throw invalid();

          return manifest;
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
    );
  }

  read(id: BackupId): Promise<string> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        await this.validatedArtifact(id, path);

        return boundedRead(this.artifact(id), maxArtifact).toString('base64');
      })
    );
  }

  import(bytes: string): Promise<BackupManifest> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        this.assertMutable();
        this.capacity();

        if (
          bytes.length > Math.ceil(maxArtifact / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes)
        )
          throw invalid();

        const artifact = decode(Buffer.from(bytes, 'base64'));

        writeFileSync(path, artifact.sqlite, { mode: 0o600, flag: 'wx' });
        await this.validateFile(path, artifact.manifest);
        // Imported unused pages are untrusted too; export only compact canonical live pages.

        const snapshot = Db.openSnapshot(path);

        try {
          snapshot.exec('PRAGMA journal_mode = DELETE; VACUUM;');
        } finally {
          snapshot.close();
        }

        const compact = boundedRead(path, MAX_BACKUP_BYTES);

        const manifest = {
          ...artifact.manifest,
          id: Schema.decodeUnknownSync(backupIdSchema)(randomUUID()),
          sha256: digest(compact),
          bytes: compact.length
        };

        durableWrite(this.artifact(manifest.id), encode(manifest, compact));

        return manifest;
      })
    );
  }

  delete(id: BackupId): Promise<void> {
    return this.exclusive(() => {
      this.assertMutable();
      rmSync(this.artifact(id), { force: true });

      if (this.preview?.backup.id === id) this.preview = undefined;

      syncDirectory(this.root);
    });
  }

  previewRestore(id: BackupId): Promise<RestorePreview> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        this.assertMutable();

        const { manifest } = await this.validatedArtifact(id, path);

        const { scope: current, identity: target } = await this.policy.inspect(this.db);

        const preview: RestorePreview = {
          token: Schema.decodeUnknownSync(restoreTokenSchema)(randomUUID()),
          backup: manifest,
          current,
          target,
          requiresRestart: true,
          requiresSignIn: true,
          replacesAllContent: true,
          backupRetainsDeletedContent: true,
          // Without proven lineage, never overlay numeric barriers from unrelated databases.
          blockedByCurrentBarriers: this.policy.blocksRestore(current)
        };

        this.preview = preview;

        return preview;
      })
    );
  }

  accept(input: typeof acceptRestoreSchema.Type): Promise<typeof restoreStatusSchema.Type> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        input = Schema.decodeUnknownSync(acceptRestoreSchema)(input);

        const accepted = this.journal();

        if (
          accepted &&
          accepted.token === input.token &&
          accepted.backupId === input.backupId &&
          accepted.target === input.target &&
          accepted.sha256 === input.sha256
        )
          return this.statusUnsafe();

        this.assertMutable();

        const preview = this.preview;

        if (
          !input.acknowledgeReplacement ||
          !preview ||
          preview.token !== input.token ||
          preview.backup.id !== input.backupId ||
          preview.backup.sha256 !== input.sha256 ||
          preview.target !== input.target ||
          preview.blockedByCurrentBarriers
        )
          throw conflict();

        const artifact = await this.validatedArtifact(input.backupId, path);

        if (artifact.manifest.sha256 !== input.sha256 || this.db.contentIdentity() !== input.target)
          throw conflict();

        const staged = join(this.root, 'restore.sqlite');

        if (existsSync(join(this.root, 'previous.sqlite'))) throw conflict();

        durableWrite(staged, artifact.sqlite);
        this.writeJournal({
          state: 'restart-required',
          token: input.token,
          backupId: input.backupId,
          target: input.target,
          restored: artifact.identity,
          sha256: input.sha256
        });
        this.preview = undefined;

        return this.statusUnsafe();
      })
    );
  }

  private statusUnsafe(): typeof restoreStatusSchema.Type {
    const journal = this.journal();

    return {
      state: journal?.state ?? 'idle',
      backupId: journal?.backupId ?? null,
      recoveryCopy: existsSync(join(this.root, 'previous.sqlite'))
    };
  }

  status(): Promise<typeof restoreStatusSchema.Type> {
    return this.exclusive(() => this.statusUnsafe());
  }

  discardRecovery(): Promise<void> {
    return this.exclusive(() => {
      this.assertMutable();
      removeDatabase(join(this.root, 'previous.sqlite'));
      removeDatabase(join(this.root, 'restore.sqlite'));
      rmSync(join(this.root, 'restore.json'), { force: true });
      syncDirectory(this.root);
    });
  }

  /** Runs before any App connection/auth/worker is acquired. Never replaces an open connection. */
  static async activate(path: string, policy: SnapshotPolicy): Promise<void> {
    if (path === ':memory:' || !existsSync(path + '.backups')) return;

    const root = path + '.backups';

    cleanInterrupted(root);

    const journal = readJournal(root);

    if (!journal) {
      removeDatabase(join(root, 'restore.sqlite'));

      return;
    }

    if (journal.state !== 'restart-required') {
      removeDatabase(join(path + '.backups', 'restore.sqlite'));

      return;
    }

    // Opening the current supported file performs SQLite's normal WAL recovery, not migrations.

    let current: Db | undefined;

    try {
      current = Db.openSnapshot(path);
    } catch {
      // A changed application schema cannot activate format 1. Let ordinary startup migrate the target.
      durableWrite(
        join(path + '.backups', 'restore.json'),
        JSON.stringify({ ...journal, state: 'activation-failed' })
      );
      removeDatabase(join(path + '.backups', 'restore.sqlite'));

      return;
    }

    const owner = new ManagedBackups(current, policy);

    try {
      owner.initialize();

      const identity = current.contentIdentity();

      const staged = join(owner.root, 'restore.sqlite');

      const previous = join(owner.root, 'previous.sqlite');

      if (identity === journal.restored && existsSync(previous)) {
        // Crash after atomic replacement and before recording activation.
        await policy.validate(current);
        owner.writeJournal({ ...journal, state: 'applied' });

        return;
      }

      if (identity !== journal.target) {
        owner.writeJournal({ ...journal, state: 'target-changed' });
        removeDatabase(staged);

        return;
      }

      const bytes = boundedRead(staged, MAX_BACKUP_BYTES);

      if (digest(bytes) !== journal.sha256) throw invalid();

      const detail = await owner.validateFile(staged);

      if (detail.identity !== journal.restored) throw invalid();

      // Exactly one explicit private rollback copy; retained until discardRecovery.
      removeDatabase(previous);
      await current.snapshot(previous, MAX_BACKUP_BYTES);
      chmodSync(previous, 0o600);
      syncFile(previous);
      syncDirectory(owner.root);
      current.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
      current.close();
      current = undefined;
      rmSync(path + '-wal', { force: true });
      rmSync(path + '-shm', { force: true });
      // Same filesystem, one atomic replacement: after failure the target is old or new.
      renameSync(staged, path);
      syncFile(path);
      syncDirectory(dirname(path));
      syncDirectory(owner.root);
      owner.writeJournal({ ...journal, state: 'applied' });
    } catch (cause) {
      if (!current) throw cause;

      // Pre-commit failure leaves the old database usable and exposes an explicit retry boundary.
      owner.writeJournal({ ...journal, state: 'activation-failed' });
      removeDatabase(join(owner.root, 'restore.sqlite'));
    } finally {
      current?.close();
    }
  }
}

export class BackupStorage extends Context.Service<
  BackupStorage,
  { readonly owner: ManagedBackups }
>()('study/capabilities/BackupStorage') {}
