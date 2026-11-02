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

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { createBlock } from '@study/contracts/sources/document';
import {
  backupManifestSchema,
  backupIdSchema,
  restoreTokenSchema
} from '@study/contracts/system/backups';
import type { BackupManifest, RestorePreview } from '@study/contracts/system/backups';
import { Db, eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Auth } from '#server/features/auth/index';
import { Learning } from '#server/features/learning/index';
import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { System } from '#server/features/system/index';
import { App, serve } from '#server/runtime/index';

const meta = {
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
const document = (text: string) => ({
  meta,
  blocks: [createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] })]
});
const acceptance = (preview: RestorePreview) => ({
  token: preview.token,
  backupId: preview.backup.id,
  sha256: preview.backup.sha256,
  target: preview.target,
  acknowledgeReplacement: true as const
});

async function fixture() {
  const location = createTestDatabase();
  let app = await App.open({
    path: location.path,
    fetch: async () => {
      throw new Error('Backup must not make a network request');
    }
  });
  return {
    location,
    get app() {
      return app;
    },
    api: () => app.nativeRuntime.runPromise(System),
    async reopen() {
      await app.close();
      app = await App.open({
        path: location.path,
        fetch: async () => {
          throw new Error('Restore must not make a network request');
        }
      });
    },
    async close() {
      await app.close();
      location.cleanup();
    }
  };
}
async function createDocument(app: App, text = 'Retained rich content') {
  return app.nativeRuntime.runPromise(
    Effect.flatMap(Materials, (m) =>
      m.createManualDocument({ title: text, document: document(text) })
    )
  );
}
function packet(bytes: Buffer) {
  const length = bytes.readUInt32BE(9);
  return {
    manifest: Schema.decodeUnknownSync(backupManifestSchema)(
      JSON.parse(bytes.subarray(13, 13 + length).toString())
    ),
    sqlite: bytes.subarray(13 + length)
  };
}
function repack(manifest: BackupManifest, sqlite: Buffer): string {
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
function changedArtifact(
  dir: string,
  bytes: string,
  edit: (db: DatabaseSync, manifest: BackupManifest) => void
) {
  const parsed = packet(Buffer.from(bytes, 'base64'));
  const path = join(dir, randomUUID() + '.sqlite');
  writeFileSync(path, parsed.sqlite);
  const db = new DatabaseSync(path);
  try {
    edit(db, parsed.manifest);
  } finally {
    db.close();
  }
  try {
    return repack(parsed.manifest, readFileSync(path));
  } finally {
    rmSync(path);
  }
}

test('System native API inventory includes the managed backup lifecycle', async () => {
  const { SystemRpc } = await import('@study/contracts/system/rpc');
  assert.deepEqual(
    [...SystemRpc.requests.keys()].sort(),
    [
      'system.acceptRestore',
      'system.createBackup',
      'system.deleteBackup',
      'system.discardRestoreRecovery',
      'system.health',
      'system.importBackup',
      'system.listBackups',
      'system.previewRestore',
      'system.readBackup',
      'system.restoreStatus',
      'system.search',
      'system.startWorkers',
      'system.stopWorkers'
    ].sort()
  );
});

test('native RPC creates, inspects and exports a backup without changing live content', async () => {
  const f = await fixture();
  const server = await serve(f.app);
  try {
    await createDocument(f.app);
    const before = f.app.store.db.contentIdentity();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const backup = yield* client['system.createBackup']({});
          assert.equal(backup.scope.materials, 1);
          assert.equal(backup.credentials, 'excluded');
          const list = yield* client['system.listBackups']({});
          assert.equal(list[0]?.id, backup.id);
          const bytes = yield* client['system.readBackup']({ id: backup.id });
          assert.equal(packet(Buffer.from(bytes, 'base64')).manifest.sha256, backup.sha256);
        })
      )
    );
    assert.equal(f.app.store.db.contentIdentity(), before);
  } finally {
    await server.close();
    await f.close();
  }
});

test('backup compaction removes private auth markers from all exported bytes; restore requires fresh sign-in', async () => {
  const f = await fixture();
  try {
    const marker = 'PRIVATE_AUTH_BACKUP_MARKER_' + randomUUID();
    // Set private persisted data only after Auth initialized; this is an isolated fixture.
    f.app.store.db.orm
      .insert(s.preferences)
      .values({
        scope: 'private.chatgpt',
        key: 'account',
        value: JSON.stringify({ refreshToken: marker })
      })
      .run();
    const api = await f.api();
    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());
    const bytes = await f.app.nativeRuntime.runPromise(api.readBackup({ id: backup.id }));
    assert.equal(Buffer.from(bytes, 'base64').includes(Buffer.from(marker)), false);
    assert.equal(
      f.app.store.db.orm
        .select()
        .from(s.preferences)
        .all()
        .some((row) => row.value.includes(marker)),
      true
    );
    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));
    assert.equal(
      (await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)))).state,
      'restart-required'
    );
    await f.reopen();
    const status = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Auth, (auth) => auth.status())
    );
    assert.equal(status.signedIn, false);
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).acceptRestore(acceptance(preview))))
        .state,
      'applied'
    );
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state,
      'applied'
    );
  } finally {
    await f.close();
  }
});

test('Materials, Documents, managed BLOBs, collections, sessions and annotations roundtrip on startup', async () => {
  const f = await fixture();
  try {
    const saved = await createDocument(f.app);
    const source = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Sources, (sources) =>
        sources.createSource({
          name: 'notes.txt',
          bytes: Buffer.from('Exact source bytes'),
          projectId: null
        })
      )
    );
    const image = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Sources, (sources) =>
        sources.createSource({
          name: 'image.png',
          bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
          projectId: null
        })
      )
    );
    await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Materials, (materials) =>
        materials.createManualDocument({
          title: 'Managed image',
          document: {
            meta,
            blocks: [
              createBlock({
                type: 'image',
                sourceId: image.id,
                revision: 1,
                alt: 'Managed image bytes'
              })
            ]
          }
        })
      )
    );
    const quiz = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Materials, (materials) =>
        materials.create({
          title: 'Retained quiz',
          publish: true,
          content: {
            kind: 'quiz',
            questions: [
              {
                kind: 'open',
                prompt: 'Why?',
                explanation: 'Because',
                referenceAnswer: 'A retained answer'
              }
            ]
          }
        })
      )
    );
    await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Learning, (learning) => learning.startQuiz({ versionId: quiz.version.id }))
    );
    const db = f.app.store.db.orm;
    db.run(sql`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Collection',1,1)`);
    db.run(
      sql`INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1)`
    );
    db.run(sql`INSERT INTO project_materials(project_id,material_id) VALUES(1,${saved.id})`);
    db.run(
      sql`INSERT INTO learning_practice_controls(project_id,epoch,enabled) VALUES(1,'captured-epoch',1)`
    );
    db.run(
      sql`INSERT INTO learning_practice_slots(id,project_id,epoch,ordinal,kind,status,input_version_ids) VALUES('pending-slot',1,'captured-epoch',0,'choice','pending',${JSON.stringify([String(saved.version.id)])})`
    );
    const documentId = db
      .select()
      .from(s.material_document_versions)
      .where(eq(s.material_document_versions.version_id, saved.version.id))
      .get()!.document_id;
    const block = db.select().from(s.blocks).where(eq(s.blocks.document_id, documentId)).get()!;
    await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Materials, (materials) =>
        materials.createAnnotation({
          kind: 'note',
          note: 'Retained note',
          target: {
            materialId: saved.id,
            range: {
              versionId: saved.version.id,
              documentId,
              blockId: block.editing_id,
              start: 0,
              end: 3
            }
          }
        })
      )
    );
    const expected = {
      questions: db.select().from(s.material_quiz_questions).all(),
      attempts: db.select().from(s.material_quiz_attempts).all(),
      imageRoots: db.select().from(s.document_assets).all(),
      documents: db.select().from(s.documents).all(),
      blocks: db.select().from(s.blocks).all(),
      assets: db.select().from(s.source_snapshots).all(),
      originals: db.select().from(s.source_blobs).all(),
      annotations: db.select().from(s.material_annotation_revisions).all()
    };
    const api = await f.api();
    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());
    db.run(sql`UPDATE projects SET name='Replaced content' WHERE id=1`);
    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    assert.equal(db.select().from(s.projects).get()!.name, 'Replaced content');
    await f.reopen();
    const restored = f.app.store.db.orm;
    assert.equal(restored.select().from(s.projects).get()!.name, 'Collection');
    assert.equal(restored.select().from(s.sessions).get()!.title, 'Session');
    assert.deepEqual(restored.select().from(s.material_quiz_questions).all(), expected.questions);
    assert.deepEqual(restored.select().from(s.material_quiz_attempts).all(), expected.attempts);
    assert.deepEqual(restored.select().from(s.document_assets).all(), expected.imageRoots);
    assert.equal(restored.select().from(s.learning_practice_controls).get()!.enabled, false);
    assert.equal(restored.select().from(s.learning_practice_slots).get()!.status, 'cancelled');
    assert.deepEqual(restored.select().from(s.documents).all(), expected.documents);
    assert.deepEqual(restored.select().from(s.blocks).all(), expected.blocks);
    assert.deepEqual(restored.select().from(s.source_snapshots).all(), expected.assets);
    assert.deepEqual(restored.select().from(s.source_blobs).all(), expected.originals);
    assert.deepEqual(
      restored.select().from(s.material_annotation_revisions).all(),
      expected.annotations
    );
    assert.equal(
      restored.select().from(s.sources).where(eq(s.sources.id, source.id)).get()!.name,
      'notes.txt'
    );
    const status = await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus());
    assert.equal(status.recoveryCopy, true);
    await f.app.nativeRuntime.runPromise((await f.api()).discardRestoreRecovery());
    assert.equal(existsSync(f.location.path + '.backups/previous.sqlite'), false);
    assert.equal(restored.select().from(s.projects).get()!.name, 'Collection');
  } finally {
    await f.close();
  }
});

test('corrupt checksum, unsupported schema, missing original BLOB and malformed canonical Document never touch live data', async () => {
  const f = await fixture();
  try {
    await createDocument(f.app);
    const api = await f.api();
    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());
    const bytes = await f.app.nativeRuntime.runPromise(api.readBackup({ id: backup.id }));
    const target = f.app.store.db.contentIdentity();
    const corrupt = Buffer.from(bytes, 'base64');
    corrupt[corrupt.length - 20] = corrupt[corrupt.length - 20]! ^ 1;
    const future = packet(Buffer.from(bytes, 'base64'));
    Object.assign(future.manifest, { version: 2 });
    const variants = [
      repack(future.manifest, future.sqlite),
      corrupt.toString('base64'),
      Buffer.from(bytes, 'base64').subarray(0, 100).toString('base64'),
      changedArtifact(f.location.dir, bytes, (db) =>
        db.exec('CREATE TRIGGER untrusted AFTER INSERT ON projects BEGIN DELETE FROM projects; END')
      ),
      changedArtifact(f.location.dir, bytes, (db, manifest) => {
        db.prepare(
          "INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(999,'import','text','text/plain','Missing original',1,?,1)"
        ).run(Buffer.alloc(32));
        Object.assign(manifest, {
          scope: { ...manifest.scope, sources: manifest.scope.sources + 1 }
        });
      }),
      changedArtifact(f.location.dir, bytes, (db, manifest) => {
        db.exec("INSERT INTO documents(extractor_version,meta,created_at) VALUES(1,'{}',1)");
        Object.assign(manifest, {
          scope: { ...manifest.scope, documents: manifest.scope.documents + 1 }
        });
      })
    ];
    for (const bytes of variants) {
      await assert.rejects(f.app.nativeRuntime.runPromise(api.importBackup({ bytes })));
      assert.equal(f.app.store.db.contentIdentity(), target);
    }
    assert.equal((await f.app.nativeRuntime.runPromise(api.listBackups())).length, 1);
  } finally {
    await f.close();
  }
});

test('acceptance is exact and idempotent; stale target/token and overlapping backup work are rejected', async () => {
  const f = await fixture();
  try {
    const api = await f.api();
    const creating = f.app.nativeRuntime.runPromise(api.createBackup());
    await assert.rejects(f.app.nativeRuntime.runPromise(api.createBackup()));
    const backup = await creating;
    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));
    await assert.rejects(
      f.app.nativeRuntime.runPromise(
        api.acceptRestore({
          ...acceptance(preview),
          token: Schema.decodeUnknownSync(restoreTokenSchema)(randomUUID())
        })
      )
    );
    await createDocument(f.app, 'Changed target');
    await assert.rejects(f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview))));
    const fresh = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));
    const accepted = await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(fresh)));
    assert.deepEqual(
      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(fresh))),
      accepted
    );
    await assert.rejects(f.app.nativeRuntime.runPromise(api.createBackup()));
    await assert.rejects(f.app.nativeRuntime.runPromise(api.deleteBackup({ id: backup.id })));
    await createDocument(f.app, 'Changed after acceptance');
    const before = f.app.store.db.contentIdentity();
    await f.reopen();
    assert.equal(f.app.store.db.contentIdentity(), before);
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state,
      'target-changed'
    );
  } finally {
    await f.close();
  }
});

test('later deletion barriers block old backup acceptance; fresh-machine import retains existing tombstones', async () => {
  const f = await fixture();
  const fresh = await fixture();
  try {
    const api = await f.api();
    const old = await f.app.nativeRuntime.runPromise(api.createBackup());
    f.app.store.db.orm.run(
      sql`INSERT INTO session_deletions(session_id,operation_id,status,created_at,completed_at) VALUES(99,'del-session','completed',1,2)`
    );
    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: old.id }));
    assert.equal(preview.blockedByCurrentBarriers, true);
    await assert.rejects(f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview))));
    const retained = await f.app.nativeRuntime.runPromise(api.createBackup());
    const bytes = await f.app.nativeRuntime.runPromise(api.readBackup({ id: retained.id }));
    const freshApi = await fresh.api();
    const imported = await fresh.app.nativeRuntime.runPromise(freshApi.importBackup({ bytes }));
    const newPreview = await fresh.app.nativeRuntime.runPromise(
      freshApi.previewRestore({ id: imported.id })
    );
    assert.equal(newPreview.blockedByCurrentBarriers, false);
    await fresh.app.nativeRuntime.runPromise(freshApi.acceptRestore(acceptance(newPreview)));
    await fresh.reopen();
    assert.equal(
      fresh.app.store.db.orm.select().from(s.session_deletions).get()!.operation_id,
      'del-session'
    );
  } finally {
    await f.close();
    await fresh.close();
  }
});

test('unfinished cleanup rejects backup creation and is preserved for its owning retry', async () => {
  const f = await fixture();
  try {
    f.app.store.db.orm.run(
      sql`INSERT INTO session_deletions(session_id,operation_id,status,error_kind,created_at) VALUES(99,'failed-cleanup','failed','internal',1)`
    );
    const before = f.app.store.db.contentIdentity();
    const api = await f.api();
    await assert.rejects(f.app.nativeRuntime.runPromise(api.createBackup()));
    assert.equal(f.app.store.db.contentIdentity(), before);
    assert.equal(existsSync(f.location.path + '.backups/scratch.sqlite'), false);
    assert.equal(f.app.store.db.orm.select().from(s.session_deletions).get()!.status, 'failed');
  } finally {
    await f.close();
  }
});

test('staged corruption reports activation failure, preserves old target and permits an explicit retry', async () => {
  const f = await fixture();
  try {
    const api = await f.api();
    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());
    await createDocument(f.app, 'Current target');
    const before = f.app.store.db.contentIdentity();
    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    writeFileSync(f.location.path + '.backups/restore.sqlite', Buffer.from('interrupted staging'));
    await f.reopen();
    assert.equal(f.app.store.db.contentIdentity(), before);
    const reopenedApi = await f.api();
    assert.equal(
      (await f.app.nativeRuntime.runPromise(reopenedApi.restoreStatus())).state,
      'activation-failed'
    );
    await f.app.nativeRuntime.runPromise(reopenedApi.discardRestoreRecovery());
    const retry = await f.app.nativeRuntime.runPromise(
      reopenedApi.previewRestore({ id: backup.id })
    );
    await f.app.nativeRuntime.runPromise(reopenedApi.acceptRestore(acceptance(retry)));
    await f.reopen();
    assert.equal(f.app.store.db.orm.select().from(s.materials).all().length, 0);
  } finally {
    await f.close();
  }
});

test('crash after replacement reconciles to new state before workers start; captured native work never resumes', async () => {
  const f = await fixture();
  try {
    const source = await f.app.nativeRuntime.runPromise(
      Effect.flatMap(Sources, (sources) =>
        sources.createSource({
          name: 'work.txt',
          bytes: Buffer.from('Native work input'),
          projectId: null
        })
      )
    );
    const db = f.app.store.db.orm;
    const event = db.select().from(s.workflowEvents).get()!;
    db.run(
      sql`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,owner_token,created_at,updated_at) VALUES('captured','study/test',1,${JSON.stringify({ event: JSON.parse(event.payload) })},'suspended','old-owner',1,1)`
    );
    db.run(
      sql`INSERT INTO workflow_configuration_waits(execution_id,deferred_name,observed_revision) VALUES('captured','config','old-revision')`
    );
    db.run(
      sql`INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES('captured','checkpoint',0,'{}')`
    );
    const api = await f.api();
    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());
    // Live captured work remains owned and unchanged by backup preparation.
    assert.equal(db.select().from(s.workflow_executions).get()!.status, 'suspended');
    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    await f.app.close();
    // Simulate process loss after atomic rename, before journal settlement.
    const old = Db.openSnapshot(f.location.path);
    await old.snapshot(f.location.path + '.backups/previous.sqlite');
    old.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
    old.close();
    renameSync(f.location.path + '.backups/restore.sqlite', f.location.path);
    await f.reopen();
    const restored = f.app.store.db.orm;
    assert.equal(restored.select().from(s.workflow_executions).get()!.status, 'cancelled');
    assert.equal(restored.select().from(s.workflow_executions).get()!.owner_token, null);
    assert.equal(restored.select().from(s.workflow_activities).all().length, 0);
    assert.equal(restored.select().from(s.workflow_configuration_waits).all().length, 0);
    assert.equal(
      restored.select().from(s.workflow_retired_executions).get()!.execution_id,
      'captured'
    );
    await f.app.workers.start();
    await f.app.workers.stop();
    assert.equal(restored.select().from(s.workflow_executions).all().length, 1);
    assert.equal(
      restored.select().from(s.sources).where(eq(s.sources.id, source.id)).get()!.name,
      'work.txt'
    );
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state,
      'applied'
    );
  } finally {
    await f.close();
  }
});

test('artifact deletion is bounded to an opaque managed identity and never removes live or external files', async () => {
  const f = await fixture();
  try {
    const api = await f.api();
    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());
    const external = join(f.location.dir, 'user-saved.studybackup');
    writeFileSync(external, 'External copy');
    assert.throws(() => Schema.decodeUnknownSync(backupIdSchema)('../user-saved'));
    const before = f.app.store.db.contentIdentity();
    await f.app.nativeRuntime.runPromise(api.deleteBackup({ id: backup.id }));
    assert.equal(readFileSync(external, 'utf8'), 'External copy');
    assert.equal(f.app.store.db.contentIdentity(), before);
    assert.equal((await f.app.nativeRuntime.runPromise(api.listBackups())).length, 0);
  } finally {
    await f.close();
  }
});
