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

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import { backupManifestSchema } from '@study/contracts/system/backups';
import type { BackupManifest, RestorePreview } from '@study/contracts/system/backups';
import { Db } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Schema } from 'effect';

import { Materials } from '#server/features/materials/index';
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
  const location = createTestDatabase();

  const requests: string[] = [];

  const open = () => {
    const started = performance.now();

    return App.open({
      path: location.path,
      onPhase: (phase) =>
        t?.log(
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
    location.cleanup();

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
      await inTestPhase(t, 'fixture-files-cleanup', () => location.cleanup());
    }
  };
}

export async function createDocument(app: App, text = 'Retained rich content') {
  return app.nativeRuntime.runPromise(
    Effect.flatMap(Materials, (m) =>
      m.createManualDocument({ title: text, document: document(text) })
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
      sha256: createHash('sha256').update(sqlite).digest('hex')
    })
  );

  const size = Buffer.alloc(4);

  size.writeUInt32BE(json.length);

  return Buffer.concat([Buffer.from('STUDYBK1\n'), size, json, sqlite]).toString('base64');
}

export function changedArtifact(
  dir: string,
  bytes: string,
  edit: (db: Db, manifest: BackupManifest) => void
) {
  const parsed = packet(Buffer.from(bytes, 'base64'));

  const path = join(dir, randomUUID() + '.sqlite');

  writeFileSync(path, parsed.sqlite);

  try {
    const db = Db.openSnapshot(path);

    try {
      edit(db, parsed.manifest);
    } finally {
      db.close();
    }

    return repack(parsed.manifest, readFileSync(path));
  } finally {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
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
