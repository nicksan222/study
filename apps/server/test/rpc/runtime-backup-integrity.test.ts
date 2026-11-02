/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Rejects rechecksummed hostile artifacts before replacement or candidate execution. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises canonical themes, managed asset revisions, schema receipts and file bounds.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Mutates isolated artifact copies with ordinary SQLite guards enabled; live DB is intact. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import { MAX_MANAGED_BACKUPS } from '@study/contracts/system/backups';
import type { BackupManifest } from '@study/contracts/system/backups';
import { sql } from '@study/db';
import type { Db } from '@study/db';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { backupFixture, changedArtifact, meta, packet } from '#testing/managed-backups';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mS8AAAAASUVORK5CYII=',
  'base64'
);

test('rechecksummed theme, asset revision, migration receipt and virtual schema tampering is rejected', async () => {
  const f = await backupFixture();

  try {
    const image = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Sources, (sources) =>
        sources.createSource({ name: 'image.png', bytes: png, projectId: null })
      )
    );

    await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Materials, (materials) =>
        materials.createManualDocument({
          title: 'Image root',
          document: {
            meta,
            blocks: [
              createBlock({ type: 'image', sourceId: image.id, revision: 1, alt: 'Retained asset' })
            ]
          }
        })
      )
    );
    await f.app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;

        const session = yield* c.createUntitledSession({});

        yield* c.captureSessionContext({
          sessionId: session.id,
          intentKey: 'retained',
          instruction: '',
          preferences: {}
        });
      })
    );

    const api = await f.api();

    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

    const bytes = await f.app.nativeRuntime.runPromise(api.readBackup({ id: backup.id }));

    const before = f.app.store.db.contentIdentity();

    const changes = [
      (db: Db) => {
        db.exec("INSERT INTO themes(id,definition,builtin) VALUES('hostile','{}',0)");
      },
      (db: Db, manifest: BackupManifest) => {
        // Insert an unpinned, current revision: updates to retained revisions remain guarded.
        db.orm.run(sql`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at)
          VALUES(999,'import','image','image/png','untrusted.png',${png.length},${createHash('sha256').update(png).digest()},1)`);
        db.orm.run(sql`INSERT INTO source_blobs(source_id,bytes) VALUES(999,${png})`);
        db.exec(
          "INSERT INTO source_processing(source_id,revision,request_id) VALUES(999,1,'untrusted-current')"
        );
        db.orm.run(
          sql`INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(999,1,${Buffer.from('corrupted managed revision')},'image','image/png')`
        );
        Object.assign(manifest, {
          scope: { ...manifest.scope, sources: manifest.scope.sources + 1 }
        });
      },
      (db: Db) => {
        db.exec("UPDATE __drizzle_migrations SET hash='not-supported'");
      },
      (db: Db) => {
        db.exec('CREATE VIRTUAL TABLE hostile USING fts5(body)');
      },
      (db: Db) => {
        db.exec(`INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot)
        SELECT request_id||'-forged',session_id,'forged',json_set(intent,'$.intentKey','forged'),json_set(snapshot,'$.requestId',request_id||'-forged','$.intentKey','forged') FROM session_run_contexts`);
      }
    ];

    const originalPacket = packet(Buffer.from(bytes, 'base64'));

    const patched = Buffer.from(originalPacket.sqlite);

    const at = patched.lastIndexOf(png);

    assert.ok(at >= 0);
    patched[at + png.length - 1] = patched[at + png.length - 1]! ^ 1;

    const { repack } = await import('#testing/managed-backups');

    await assert.rejects(
      f.app.nativeRuntime.runPromise(
        api.importBackup({ bytes: repack(originalPacket.manifest, patched) })
      )
    );

    for (const change of changes) {
      await assert.rejects(
        f.app.nativeRuntime.runPromise(
          api.importBackup({ bytes: changedArtifact(f.location.dir, bytes, change) })
        )
      );
      assert.equal(f.app.store.db.contentIdentity(), before);
      assert.equal(existsSync(f.location.path + '.backups/scratch.sqlite'), false);
    }

    assert.deepEqual(
      (await f.app.nativeRuntime.runPromise(api.backups())).map((b) => b.id),
      [backup.id]
    );
  } finally {
    await f.close();
  }
});

test('manifest and byte bounds reject malformed transport without allocating managed artifacts', async () => {
  const f = await backupFixture();

  try {
    const api = await f.api();

    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

    const exported = Buffer.from(
      await f.app.nativeRuntime.runPromise(api.readBackup({ id: backup.id })),
      'base64'
    );

    const oversizedManifest = Buffer.from(exported);

    oversizedManifest.writeUInt32BE(8193, 9);

    const missingBody = exported.subarray(0, exported.length - packet(exported).sqlite.length);

    for (const bytes of [
      '../escape',
      '!!!!',
      exported.toString('base64') + '=',
      oversizedManifest.toString('base64'),
      missingBody.toString('base64')
    ])
      await assert.rejects(f.app.nativeRuntime.runPromise(api.importBackup({ bytes })));

    assert.equal((await f.app.nativeRuntime.runPromise(api.backups())).length, 1);

    for (let index = 1; index < MAX_MANAGED_BACKUPS; index++)
      await f.app.nativeRuntime.runPromise(api.createBackup());

    await assert.rejects(f.app.nativeRuntime.runPromise(api.createBackup()));
    assert.equal((await f.app.nativeRuntime.runPromise(api.backups())).length, MAX_MANAGED_BACKUPS);
    assert.equal(
      readdirSync(f.location.path + '.backups').some(
        (name) => name.endsWith('.writing') || name.startsWith('scratch.sqlite')
      ),
      false
    );
  } finally {
    await f.close();
  }
});
