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

import { StudyError } from '@study/contracts/errors';
import {
  MAX_BACKUP_BYTES,
  MAX_MANAGED_BACKUPS,
  backupIdSchema,
  backupManifestSchema,
  restoreTokenSchema,
  backupDigestSchema,
  acceptRestoreSchema
} from '@study/contracts/system/backups';
import type { BackupId, BackupManifest, RestorePreview } from '@study/contracts/system/backups';
import type { backupScopeSchema, restoreStatusSchema } from '@study/contracts/system/backups';
import { Db } from '@study/db';
import { CryptoHasher } from 'bun';
import type { Clock } from 'effect';
import { Context, Effect, Option, Schema } from 'effect';

import { fileSystem, nativePaths, runFileSystemPromise } from '#server/platform/filesystem/index';
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

const digest = (bytes: Uint8Array) => new CryptoHasher('sha256').update(bytes).digest('hex');

const invalid = () => new StudyError('invalid_input', 'Invalid or incompatible backup');

const conflict = () =>
  new StudyError('invalid_input', 'Backup operation conflicts with current state');

const paths = nativePaths;

const { join, dirname } = paths;

const exists = async (path: string) => runFileSystemPromise((await fileSystem).exists(path));

const remove = async (path: string) =>
  runFileSystemPromise((await fileSystem).remove(path, { force: true }));

const rename = async (from: string, to: string) =>
  runFileSystemPromise((await fileSystem).rename(from, to));

const chmod = async (path: string, mode: number) =>
  runFileSystemPromise((await fileSystem).chmod(path, mode));

async function syncFile(path: string) {
  const fs = await fileSystem;

  await runFileSystemPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(path, { flag: 'r', noFollow: process.platform !== 'win32' });

        yield* file.sync;
      })
    )
  );
}

async function syncDirectory(path: string) {
  if (process.platform !== 'win32') await syncFile(path);
}

async function removeDatabase(path: string) {
  const fs = await fileSystem;

  for (const suffix of ['', '-wal', '-shm', '-journal'])
    await runFileSystemPromise(fs.remove(path + suffix, { force: true }));
}

async function privateDirectory(path: string) {
  const fs = await fileSystem;

  await runFileSystemPromise(fs.makeDirectory(path, { recursive: true, mode: 0o700 }));

  if ((await runFileSystemPromise(fs.lstat(path))).type !== 'Directory') throw invalid();

  if (process.platform !== 'win32') await runFileSystemPromise(fs.chmod(path, 0o700));
}

async function boundedRead(path: string, maximum: number): Promise<Buffer> {
  const fs = await fileSystem;

  return runFileSystemPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(path, { flag: 'r', noFollow: process.platform !== 'win32' });
        const stat = yield* file.stat;
        const size = Number(stat.size);

        if (stat.type !== 'File' || size > maximum || size < 1) throw invalid();

        const result = yield* file.readAlloc(size + 1);

        if (Option.isNone(result) || result.value.length !== size) throw invalid();

        return Buffer.from(result.value);
      })
    )
  );
}

async function writeExclusive(path: string, bytes: Uint8Array | string) {
  const fs = await fileSystem;
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;

  await runFileSystemPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(path, { flag: 'wx', mode: 0o600 });

        yield* file.writeAll(data);
        yield* file.sync;
      })
    )
  );
}

async function durableWrite(path: string, bytes: Uint8Array | string) {
  const fs = await fileSystem;
  const temporary = path + '.writing';

  await runFileSystemPromise(fs.remove(temporary, { force: true }));
  await writeExclusive(temporary, bytes);
  await runFileSystemPromise(fs.rename(temporary, path));
  await syncDirectory(dirname(path));
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

async function readJournal(root: string): Promise<Journal | undefined> {
  const path = join(root, 'restore.json');

  return (await exists(path))
    ? Schema.decodeUnknownSync(journalSchema)(
        JSON.parse((await boundedRead(path, 4096)).toString('utf8'))
      )
    : undefined;
}

async function cleanInterrupted(root: string) {
  await privateDirectory(root);
  await removeDatabase(join(root, 'scratch.sqlite'));

  for (const name of await runFileSystemPromise((await fileSystem).readDirectory(root))) {
    if (
      name.endsWith('.studybackup.writing') &&
      Schema.is(backupIdSchema)(name.slice(0, -'.studybackup.writing'.length))
    )
      await remove(join(root, name));
  }

  for (const name of ['restore.sqlite.writing', 'restore.json.writing'])
    await remove(join(root, name));
}

async function pendingActivation(root: string): Promise<Journal | undefined> {
  await cleanInterrupted(root);

  const journal = await readJournal(root);

  if (!journal || journal.state !== 'restart-required') {
    await removeDatabase(join(root, 'restore.sqlite'));

    return undefined;
  }

  return journal;
}

async function validateStagedDigest(staged: string, journal: Journal) {
  const bytes = await boundedRead(staged, MAX_BACKUP_BYTES);

  if (digest(bytes) !== journal.sha256) throw invalid();
}

/** One owner per App; all public operations share its overlap fence. */

export class ManagedBackups {
  readonly root: string;
  private busy = false;
  private closed = false;
  private active: Promise<void> | undefined;
  private preview: RestorePreview | undefined;

  private readonly db: Db;
  private readonly policy: SnapshotPolicy;
  private readonly clock: Clock.Clock;

  constructor(db: Db, policy: SnapshotPolicy, clock: Clock.Clock = liveClock()) {
    this.db = db;
    this.policy = policy;
    this.clock = clock;
    this.root = db.path + '.backups';
  }

  private async initialize() {
    if (this.db.path === ':memory:')
      throw new StudyError('unsupported', 'Backups require a file database');

    await privateDirectory(this.root);
  }

  private artifact(id: BackupId) {
    return join(this.root, Schema.decodeUnknownSync(backupIdSchema)(id) + '.studybackup');
  }

  private async journal(): Promise<Journal | undefined> {
    return readJournal(this.root);
  }

  private async writeJournal(value: Journal) {
    await durableWrite(
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
      await this.initialize();

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

  private async assertMutable() {
    if ((await this.journal())?.state === 'restart-required') throw conflict();
  }

  private async capacity() {
    if ((await this.names()).length >= MAX_MANAGED_BACKUPS) throw conflict();
  }

  private async names() {
    const names = (await runFileSystemPromise((await fileSystem).readDirectory(this.root))).filter(
      (name) => name.endsWith('.studybackup')
    );

    if (names.length > MAX_MANAGED_BACKUPS) throw invalid();

    return names;
  }

  private async validateFile(path: string, manifest?: BackupManifest) {
    const schema = await Db.validateSnapshot(path);

    const snapshot = await Db.openSnapshot(path);

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
    const artifact = decode(await boundedRead(this.artifact(id), maxArtifact));

    if (artifact.manifest.id !== id) throw invalid();

    await writeExclusive(scratch, artifact.sqlite);

    const detail = await this.validateFile(scratch, artifact.manifest);

    return { ...artifact, ...detail };
  }

  private async scratch<A>(work: (path: string) => Promise<A> | A): Promise<A> {
    const path = join(this.root, 'scratch.sqlite');

    await removeDatabase(path);

    try {
      return await work(path);
    } finally {
      await removeDatabase(path);
    }
  }

  create(): Promise<BackupManifest> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        await this.assertMutable();
        await this.capacity();
        await this.db.snapshot(path, MAX_BACKUP_BYTES);

        if (
          Number((await runFileSystemPromise((await fileSystem).lstat(path))).size) >
          MAX_BACKUP_BYTES
        )
          throw invalid();

        if (process.platform !== 'win32') await chmod(path, 0o600);

        const snapshot = await Db.openSnapshot(path);

        try {
          await this.policy.prepare(snapshot);
          // Rebuild exported pages after credential deletion: no freelist/WAL credential residue.
          snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; VACUUM;');
        } finally {
          snapshot.close();
        }

        const { schema, scope } = await this.validateFile(path);

        const bytes = await boundedRead(path, MAX_BACKUP_BYTES);

        const manifest = Schema.decodeUnknownSync(backupManifestSchema)({
          format: 'study-managed-backup',
          version: 1,
          id: crypto.randomUUID(),
          createdAtMs: this.clock.currentTimeMillisUnsafe(),
          schema,
          sha256: digest(bytes),
          bytes: bytes.length,
          scope,
          credentials: 'excluded',
          nativeWork: 'retired',
          compatibility: 'exact-schema'
        });

        await durableWrite(this.artifact(manifest.id), encode(manifest, bytes));

        return manifest;
      })
    );
  }

  list(): Promise<readonly BackupManifest[]> {
    return this.exclusive(async () => {
      const manifests: BackupManifest[] = [];

      for (const name of await this.names()) {
        const id = Schema.decodeUnknownSync(backupIdSchema)(name.slice(0, -'.studybackup'.length));
        const { manifest } = decode(await boundedRead(this.artifact(id), maxArtifact));

        if (manifest.id !== id) throw invalid();

        manifests.push(manifest);
      }

      return manifests.sort((a, b) => b.createdAtMs - a.createdAtMs);
    });
  }

  read(id: BackupId): Promise<string> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        await this.validatedArtifact(id, path);

        return (await boundedRead(this.artifact(id), maxArtifact)).toString('base64');
      })
    );
  }

  import(bytes: string): Promise<BackupManifest> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        await this.assertMutable();
        await this.capacity();

        if (
          bytes.length > Math.ceil(maxArtifact / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes)
        )
          throw invalid();

        const artifact = decode(Buffer.from(bytes, 'base64'));

        await writeExclusive(path, artifact.sqlite);
        await this.validateFile(path, artifact.manifest);
        // Imported unused pages are untrusted too; export only compact canonical live pages.

        const snapshot = await Db.openSnapshot(path);

        try {
          snapshot.exec('PRAGMA journal_mode = DELETE; VACUUM;');
        } finally {
          snapshot.close();
        }

        const compact = await boundedRead(path, MAX_BACKUP_BYTES);

        const manifest = {
          ...artifact.manifest,
          id: Schema.decodeUnknownSync(backupIdSchema)(crypto.randomUUID()),
          sha256: digest(compact),
          bytes: compact.length
        };

        await durableWrite(this.artifact(manifest.id), encode(manifest, compact));

        return manifest;
      })
    );
  }

  delete(id: BackupId): Promise<void> {
    return this.exclusive(async () => {
      await this.assertMutable();
      await remove(this.artifact(id));

      if (this.preview?.backup.id === id) this.preview = undefined;

      await syncDirectory(this.root);
    });
  }

  previewRestore(id: BackupId): Promise<RestorePreview> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        await this.assertMutable();

        const { manifest } = await this.validatedArtifact(id, path);

        const { scope: current, identity: target } = await this.policy.inspect(this.db);

        const preview: RestorePreview = {
          token: Schema.decodeUnknownSync(restoreTokenSchema)(crypto.randomUUID()),
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

  private async acceptedInput(input: typeof acceptRestoreSchema.Type): Promise<boolean> {
    const accepted = await this.journal();

    if (
      accepted &&
      accepted.token === input.token &&
      accepted.backupId === input.backupId &&
      accepted.target === input.target &&
      accepted.sha256 === input.sha256
    )
      return true;

    return false;
  }

  private assertPreview(input: typeof acceptRestoreSchema.Type) {
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
  }

  accept(input: typeof acceptRestoreSchema.Type): Promise<typeof restoreStatusSchema.Type> {
    return this.exclusive(() =>
      this.scratch(async (path) => {
        input = Schema.decodeUnknownSync(acceptRestoreSchema)(input);

        if (await this.acceptedInput(input)) return this.statusUnsafe();

        await this.assertMutable();
        this.assertPreview(input);

        const artifact = await this.validatedArtifact(input.backupId, path);

        if (artifact.manifest.sha256 !== input.sha256 || this.db.contentIdentity() !== input.target)
          throw conflict();

        const staged = join(this.root, 'restore.sqlite');

        if (await exists(join(this.root, 'previous.sqlite'))) throw conflict();

        await durableWrite(staged, artifact.sqlite);
        await this.writeJournal({
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

  private async statusUnsafe(): Promise<typeof restoreStatusSchema.Type> {
    const journal = await this.journal();

    return {
      state: journal?.state ?? 'idle',
      backupId: journal?.backupId ?? null,
      recoveryCopy: await exists(join(this.root, 'previous.sqlite'))
    };
  }

  status(): Promise<typeof restoreStatusSchema.Type> {
    return this.exclusive(() => this.statusUnsafe());
  }

  discardRecovery(): Promise<void> {
    return this.exclusive(async () => {
      await this.assertMutable();
      await removeDatabase(join(this.root, 'previous.sqlite'));
      await removeDatabase(join(this.root, 'restore.sqlite'));
      await remove(join(this.root, 'restore.json'));
      await syncDirectory(this.root);
    });
  }

  private async activationState(journal: Journal, staged: string, previous: string) {
    const identity = this.db.contentIdentity();

    if (identity === journal.restored && (await exists(previous))) return 'replaced';

    if (identity !== journal.target) {
      await this.writeJournal({ ...journal, state: 'target-changed' });
      await removeDatabase(staged);

      return 'changed';
    }

    return 'pending';
  }

  /** Runs before any App connection/auth/worker is acquired. Never replaces an open connection. */
  static async activate(path: string, policy: SnapshotPolicy): Promise<void> {
    if (path === ':memory:' || !(await exists(path + '.backups'))) return;

    const root = path + '.backups';

    const journal = await pendingActivation(root);

    if (!journal) return;

    let current = await openActivationTarget(path, journal);

    if (!current) return;

    const owner = new ManagedBackups(current, policy);

    try {
      await owner.initialize();

      const staged = join(owner.root, 'restore.sqlite');

      const previous = join(owner.root, 'previous.sqlite');

      const state = await owner.activationState(journal, staged, previous);

      if (state === 'replaced') {
        // Crash after atomic replacement and before recording activation.
        await policy.validate(current);
        await owner.writeJournal({ ...journal, state: 'applied' });

        return;
      }

      if (state === 'changed') return;

      await validateStagedDigest(staged, journal);

      const detail = await owner.validateFile(staged);

      if (detail.identity !== journal.restored) throw invalid();

      // Exactly one explicit private rollback copy; retained until discardRecovery.
      await createRecoveryCopy(current, previous, owner.root);
      current.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
      current.close();
      current = undefined;
      await remove(path + '-wal');
      await remove(path + '-shm');
      // Same filesystem, one atomic replacement: after failure the target is old or new.
      await rename(staged, path);
      await syncFile(path);
      await syncDirectory(dirname(path));
      await syncDirectory(owner.root);
      await owner.writeJournal({ ...journal, state: 'applied' });
    } catch (cause) {
      if (!current) throw cause;

      // Pre-commit failure leaves the old database usable and exposes an explicit retry boundary.
      await owner.writeJournal({ ...journal, state: 'activation-failed' });
      await removeDatabase(join(owner.root, 'restore.sqlite'));
    } finally {
      current?.close();
    }
  }
}

/** Preserve one private, durable rollback copy before replacing the target. */
async function createRecoveryCopy(current: Db, previous: string, root: string) {
  await removeDatabase(previous);
  await current.snapshot(previous, MAX_BACKUP_BYTES);

  if (process.platform !== 'win32') await chmod(previous, 0o600);

  await syncFile(previous);
  await syncDirectory(root);
}

/** Recover the target before activation without applying migrations. */
async function openActivationTarget(path: string, journal: Journal): Promise<Db | undefined> {
  try {
    return await Db.openSnapshot(path);
  } catch {
    // A changed schema cannot activate format 1; ordinary startup may migrate the target.
    const root = path + '.backups';

    await durableWrite(
      join(root, 'restore.json'),
      JSON.stringify({ ...journal, state: 'activation-failed' })
    );
    await removeDatabase(join(root, 'restore.sqlite'));

    return undefined;
  }
}

export class BackupStorage extends Context.Service<
  BackupStorage,
  { readonly owner: ManagedBackups }
>()('study/capabilities/BackupStorage') {}
