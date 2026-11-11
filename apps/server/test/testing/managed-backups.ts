/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises managed backup privacy, integrity, native transport and controlled       │
 * │ startup replacement with temporary databases.                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Authors corruption, replay, stale acceptance and recovery cases for parent validation. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ All fixtures use isolated SQLite locations and native services without real user data.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { createBlock } from '@study/contracts/sources/document';
import { backupManifestSchema } from '@study/contracts/system/backups';
import type { BackupManifest, RestorePreview } from '@study/contracts/system/backups';
import { Db } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, FileSystem, Path, Schema } from 'effect';
import type { TestContext } from 'vite-plus/test';

import { Pages } from '#server/features/pages/index';
import { System } from '#server/features/system/index';
import { App } from '#server/runtime/index';

import { inTestPhase } from './progress.ts';

export const meta = {
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

export const document = (text: string) => ({
  meta,
  blocks: [createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] })]
});

export const acceptance = (preview: RestorePreview) => ({
  token: preview.token,
  backupId: preview.backup.id,
  sha256: preview.backup.sha256,
  target: preview.target,
  acknowledgeReplacement: true as const
});

export async function backupFixture(t?: TestContext) {
  const location = await createTestDatabase();

  const requests: string[] = [];

  const open = async () => {
    const started = performance.now();

    return App.open({
      path: await location.prepare(),
      onPhase: (phase) =>
        console.debug(
          `study-test-phase:fixture-startup:${phase} elapsedMs=${Math.round(performance.now() - started)}`
        ),
      fetch: async (input) => {
        requests.push(String(input));

        throw new Error('Backup and restore must not make a network request');
      }
    });
  };

  let app: App;

  try {
    app = await inTestPhase(t, 'fixture-open', open);
  } catch (cause) {
    await location.cleanup();

    throw cause;
  }

  return {
    location,
    requests,
    get app() {
      return app;
    },
    api: () => app.nativeRuntime.runPromise(System),
    async suspend() {
      await inTestPhase(t, 'fixture-app-close', () => app.close());
    },
    async reopen() {
      await inTestPhase(t, 'fixture-app-close', () => app.close());
      app = await inTestPhase(t, 'fixture-open', open);
    },
    async close() {
      await inTestPhase(t, 'fixture-app-close', () => app.close());
      await inTestPhase(t, 'fixture-files-cleanup', async () => await location.cleanup());
    }
  };
}

export async function createPage(app: App, text = 'Retained rich content') {
  return app.nativeRuntime.runPromise(
    Effect.flatMap(Pages, (m) =>
      m
        .create({
          createKey: crypto.randomUUID(),
          title: text,
          document: document(text),
          inputs: [],
          citations: []
        })
        .pipe(
          Effect.map((value) => {
            if (!value.version) throw new Error('Missing created authored version');

            return { ...value, version: value.version };
          })
        )
    )
  );
}

export function packet(bytes: Buffer) {
  const length = bytes.readUInt32BE(9);

  return {
    manifest: Schema.decodeUnknownSync(backupManifestSchema)(
      JSON.parse(bytes.subarray(13, 13 + length).toString())
    ),
    sqlite: bytes.subarray(13 + length)
  };
}

export function repack(manifest: BackupManifest, sqlite: Buffer): string {
  const json = Buffer.from(
    JSON.stringify({
      ...manifest,
      bytes: sqlite.length,
      sha256: new Bun.CryptoHasher('sha256').update(sqlite).digest('hex')
    })
  );

  const size = Buffer.alloc(4);

  size.writeUInt32BE(json.length);

  return Buffer.concat([Buffer.from('STUDYBK1\n'), size, json, sqlite]).toString('base64');
}

export async function changedArtifact(
  dir: string,
  bytes: string,
  edit: (db: Db, manifest: BackupManifest) => void
) {
  const parsed = packet(Buffer.from(bytes, 'base64'));

  const filesystem = await Effect.runPromise(
    Effect.provide(FileSystem.FileSystem, BunFileSystem.layer)
  );
  const paths = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));
  const path = paths.join(dir, crypto.randomUUID() + '.sqlite');

  await Bun.write(path, parsed.sqlite);

  try {
    const db = await Db.openSnapshot(path);

    try {
      edit(db, parsed.manifest);
    } finally {
      db.close();
    }

    return repack(parsed.manifest, Buffer.from(await Bun.file(path).arrayBuffer()));
  } finally {
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      await Effect.runPromise(filesystem.remove(path + suffix, { force: true }));
  }
}

/** Export an isolated feature fixture through the same storage and policy as App. */

export async function exportSnapshot(db: Db) {
  const { ManagedBackups } = await import('#server/platform/database/backups');

  const { backupPolicy } = await import('#server/runtime/backups');

  const owner = new ManagedBackups(db, backupPolicy);

  try {
    const backup = await owner.create();

    return await owner.read(backup.id);
  } finally {
    await owner.close();
  }
}

export async function restoreSnapshot(bytes: string) {
  const f = await backupFixture();

  try {
    const api = await f.api();

    const imported = await f.app.nativeRuntime.runPromise(api.importBackup({ bytes }));

    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: imported.id }));

    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    await f.reopen();

    return f;
  } catch (cause) {
    await f.close();

    throw cause;
  }
}
