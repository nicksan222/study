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

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { StudyRpc } from '@study/contracts/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { backupIdSchema, restoreTokenSchema } from '@study/contracts/system/backups';
import { Db, eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Auth } from '#server/features/auth/index';
import { Learning } from '#server/features/learning/index';
import { Materials } from '#server/features/materials/index';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { workflowStore } from '#server/platform/workflows/store';
import { serve } from '#server/runtime/index';
import {
  acceptance,
  backupFixture,
  changedArtifact,
  createDocument,
  meta,
  packet,
  repack
} from '#testing/managed-backups';
import { inTestPhase } from '#testing/progress';

testStable('System native API inventory includes the managed backup lifecycle', async () => {
  const { SystemRpc } = await import('@study/contracts/system/rpc');

  expect([...SystemRpc.requests.keys()].sort()).toStrictEqual(
    [
      'system.acceptRestore',
      'system.createBackup',
      'system.deleteBackup',
      'system.discardRestoreRecovery',
      'system.health',
      'system.importBackup',
      'system.listBackups',
      'system.materialSearch',
      'system.previewRestore',
      'system.readBackup',
      'system.restoreStatus',
      'system.search',
      'system.startWorkers',
      'system.stopWorkers'
    ].sort()
  );
});

testStable(
  'native RPC creates, inspects and exports a backup without changing live content',
  async () => {
    const f = await backupFixture();

    const server = await serve(f.app);

    try {
      await createDocument(f.app);

      const before = f.app.store.db.contentIdentity();

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            const backup = yield* client['system.createBackup']({});

            assert.strictEqual(backup.scope.pages, 1);
            assert.ok(backup.credentials === 'excluded');

            const list = yield* client['system.listBackups']({});

            assert.strictEqual(list[0]?.id, backup.id);

            const bytes = yield* client['system.readBackup']({ id: backup.id });

            assert.strictEqual(packet(Buffer.from(bytes, 'base64')).manifest.sha256, backup.sha256);
          })
        )
      );
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
    } finally {
      await server.close();
      await f.close();
    }
  }
);

testStable(
  'backup compaction removes private auth markers from all exported bytes; restore requires fresh sign-in',
  async () => {
    const f = await backupFixture();

    try {
      const marker = 'PRIVATE_AUTH_BACKUP_MARKER_' + randomUUID();

      const previousMarker = 'PRIVATE_PREVIOUS_AUTH_' + randomUUID();

      f.app.store.db.orm
        .insert(s.preferences)
        .values({
          scope: 'private.chatgpt',
          key: 'historical',
          value: JSON.stringify(previousMarker.repeat(256))
        })
        .run();
      f.app.store.db.orm.delete(s.preferences).where(eq(s.preferences.key, 'historical')).run();
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

      assert.ok(Buffer.from(bytes, 'base64').includes(Buffer.from(marker)) === false);
      assert.ok(Buffer.from(bytes, 'base64').includes(Buffer.from(previousMarker)) === false);
      assert.ok(
        f.app.store.db.orm
          .select()
          .from(s.preferences)
          .all()
          .some((row) => row.value.includes(marker)) === true
      );

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      assert.ok(
        (await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)))).state ===
          'restart-required'
      );
      await f.reopen();

      const status = await f.app.nativeRuntime.runPromise(
        Effect.flatMap(Auth, (auth) => auth.status())
      );

      assert.ok(status.signedIn === false);
      assert.ok(
        (await f.app.nativeRuntime.runPromise((await f.api()).acceptRestore(acceptance(preview))))
          .state === 'applied'
      );
      assert.ok(
        (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state === 'applied'
      );
      assert.ok(
        readFileSync(f.location.path + '.backups/previous.sqlite').includes(Buffer.from(marker)) ===
          true
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'Materials, Pages, managed BLOBs, collections, notes and annotations roundtrip on startup',
  async () => {
    const f = await backupFixture();

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
        Effect.flatMap(Pages, (documents) =>
          documents.create({
            createKey: randomUUID(),
            inputs: [],
            citations: [],
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

      await f.app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;

          const project = yield* projects.createProject({ name: 'Collection' });

          yield* (yield* Pages).attachProject({ projectId: project.id, pageId: saved.id });
          yield* (yield* Notes).createNote({ title: 'Note' });
          yield* (yield* Learning).startPractice({
            projectId: project.id,
            inputs: [{ kind: 'page', versionId: saved.version.id }]
          });
        })
      );

      const documentId = saved.version.snapshotId;

      const block = db.select().from(s.blocks).where(eq(s.blocks.document_id, documentId)).get()!;

      await f.app.nativeRuntime.runPromise(
        Effect.flatMap(Pages, (documents) =>
          documents.createAnnotation({
            kind: 'note',
            note: 'Retained note',
            target: {
              pageId: saved.id,
              range: {
                versionId: saved.version.id,
                snapshotId: documentId,
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
        documents: db.select().from(s.content_snapshots).all(),
        blocks: db.select().from(s.blocks).all(),
        assets: db.select().from(s.source_snapshots).all(),
        originals: db.select().from(s.source_blobs).all(),
        annotations: db.select().from(s.page_annotation_revisions).all()
      };

      const api = await f.api();

      const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

      db.run(sql`UPDATE projects SET name='Replaced content' WHERE id=1`);

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      assert.ok(db.select().from(s.projects).get()!.name === 'Replaced content');
      await f.reopen();

      const restored = f.app.store.db.orm;

      assert.ok(restored.select().from(s.projects).get()!.name === 'Collection');
      assert.ok(restored.select().from(s.notes).get()!.title === 'Note');
      expect(restored.select().from(s.material_quiz_questions).all()).toStrictEqual(
        expected.questions
      );
      expect(restored.select().from(s.material_quiz_attempts).all()).toStrictEqual(
        expected.attempts
      );
      expect(restored.select().from(s.document_assets).all()).toStrictEqual(expected.imageRoots);
      assert.ok(restored.select().from(s.learning_practice_controls).get()!.enabled === false);
      assert.ok(restored.select().from(s.learning_practice_slots).get()!.status === 'cancelled');
      expect(restored.select().from(s.content_snapshots).all()).toStrictEqual(expected.documents);
      expect(restored.select().from(s.blocks).all()).toStrictEqual(expected.blocks);
      expect(restored.select().from(s.source_snapshots).all()).toStrictEqual(expected.assets);
      expect(restored.select().from(s.source_blobs).all()).toStrictEqual(expected.originals);
      expect(restored.select().from(s.page_annotation_revisions).all()).toStrictEqual(
        expected.annotations
      );
      assert.ok(
        restored.select().from(s.sources).where(eq(s.sources.id, source.id)).get()!.name ===
          'notes.txt'
      );

      const status = await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus());

      assert.ok(status.recoveryCopy === true);
      await f.app.nativeRuntime.runPromise((await f.api()).discardRestoreRecovery());
      assert.ok(existsSync(f.location.path + '.backups/previous.sqlite') === false);
      assert.ok(restored.select().from(s.projects).get()!.name === 'Collection');
    } finally {
      await f.close();
    }
  }
);

testStable(
  'corrupt checksum, unsupported schema, missing original BLOB and malformed canonical Document never touch live data',
  async () => {
    const f = await backupFixture();

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
          db.exec(
            'CREATE TRIGGER untrusted AFTER INSERT ON projects BEGIN DELETE FROM projects; END'
          )
        ),
        changedArtifact(f.location.dir, bytes, (db, manifest) => {
          db.orm.run(
            sql`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(999,'import','text','text/plain','Missing original',1,${Buffer.alloc(32)},1)`
          );
          Object.assign(manifest, {
            scope: { ...manifest.scope, sources: manifest.scope.sources + 1 }
          });
        }),
        changedArtifact(f.location.dir, bytes, (db, manifest) => {
          db.exec(
            "INSERT INTO content_snapshots(extractor_version,meta,created_at) VALUES(1,'{}',1)"
          );
          Object.assign(manifest, {
            scope: { ...manifest.scope, pages: manifest.scope.pages + 1 }
          });
        })
      ];

      for (const bytes of variants) {
        await expect(f.app.nativeRuntime.runPromise(api.importBackup({ bytes }))).rejects.toSatisfy(
          () => true
        );
        assert.strictEqual(f.app.store.db.contentIdentity(), target);
      }

      assert.strictEqual((await f.app.nativeRuntime.runPromise(api.backups())).length, 1);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'acceptance is exact and idempotent; stale target/token and overlapping backup work are rejected',
  async () => {
    const f = await backupFixture();

    try {
      const api = await f.api();

      const creating = f.app.nativeRuntime.runPromise(api.createBackup());

      await expect(f.app.nativeRuntime.runPromise(api.createBackup())).rejects.toSatisfy(
        () => true
      );

      const backup = await creating;

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      await expect(
        f.app.nativeRuntime.runPromise(
          api.acceptRestore({
            ...acceptance(preview),
            token: Schema.decodeUnknownSync(restoreTokenSchema)(randomUUID())
          })
        )
      ).rejects.toSatisfy(() => true);
      await createDocument(f.app, 'Changed target');
      await expect(
        f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)))
      ).rejects.toSatisfy(() => true);

      const fresh = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      const accepted = await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(fresh)));

      expect(
        await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(fresh)))
      ).toStrictEqual(accepted);
      await expect(f.app.nativeRuntime.runPromise(api.createBackup())).rejects.toSatisfy(
        () => true
      );
      await expect(
        f.app.nativeRuntime.runPromise(api.deleteBackup({ id: backup.id }))
      ).rejects.toSatisfy(() => true);
      await createDocument(f.app, 'Changed after acceptance');

      const before = f.app.store.db.contentIdentity();

      await f.reopen();
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
      assert.ok(
        (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state ===
          'target-changed'
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'later deletion barriers block old backup acceptance; fresh-machine import retains existing tombstones',
  async () => {
    const f = await backupFixture();

    let fresh: Awaited<ReturnType<typeof backupFixture>> | undefined;

    try {
      const api = await f.api();

      const old = await f.app.nativeRuntime.runPromise(api.createBackup());

      f.app.store.db.orm.run(
        sql`INSERT INTO note_deletions(note_id,operation_id,status,created_at,completed_at) VALUES(99,'del-note','completed',1,2)`
      );

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: old.id }));

      assert.ok(preview.blockedByCurrentBarriers === true);
      await expect(
        f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)))
      ).rejects.toSatisfy(() => true);

      const retained = await f.app.nativeRuntime.runPromise(api.createBackup());

      const bytes = await f.app.nativeRuntime.runPromise(api.readBackup({ id: retained.id }));

      await f.suspend();
      fresh = await backupFixture();

      const freshApi = await fresh.api();

      const imported = await fresh.app.nativeRuntime.runPromise(freshApi.importBackup({ bytes }));

      const newPreview = await fresh.app.nativeRuntime.runPromise(
        freshApi.previewRestore({ id: imported.id })
      );

      assert.ok(newPreview.blockedByCurrentBarriers === false);
      await fresh.app.nativeRuntime.runPromise(freshApi.acceptRestore(acceptance(newPreview)));
      await fresh.reopen();
      assert.ok(
        fresh.app.store.db.orm.select().from(s.note_deletions).get()!.operation_id === 'del-note'
      );
    } finally {
      await f.close();
      await fresh?.close();
    }
  }
);

testStable(
  'unfinished cleanup rejects backup creation and is preserved for its owning retry',
  async () => {
    const f = await backupFixture();

    try {
      f.app.store.db.orm.run(
        sql`INSERT INTO note_deletions(note_id,operation_id,status,error_kind,created_at) VALUES(99,'failed-cleanup','failed','internal',1)`
      );

      const before = f.app.store.db.contentIdentity();

      const api = await f.api();

      await expect(f.app.nativeRuntime.runPromise(api.createBackup())).rejects.toSatisfy(
        () => true
      );
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
      assert.ok(existsSync(f.location.path + '.backups/scratch.sqlite') === false);
      assert.ok(f.app.store.db.orm.select().from(s.note_deletions).get()!.status === 'failed');
    } finally {
      await f.close();
    }
  }
);

testStable(
  'staged corruption reports activation failure, preserves old target and permits an explicit retry',
  async () => {
    const f = await backupFixture();

    try {
      const api = await f.api();

      const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

      await createDocument(f.app, 'Current target');

      const before = f.app.store.db.contentIdentity();

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      writeFileSync(
        f.location.path + '.backups/restore.sqlite',
        Buffer.from('interrupted staging')
      );
      await f.reopen();
      assert.strictEqual(f.app.store.db.contentIdentity(), before);

      const reopenedApi = await f.api();

      assert.ok(
        (await f.app.nativeRuntime.runPromise(reopenedApi.restoreStatus())).state ===
          'activation-failed'
      );
      await f.app.nativeRuntime.runPromise(reopenedApi.discardRestoreRecovery());

      const retry = await f.app.nativeRuntime.runPromise(
        reopenedApi.previewRestore({ id: backup.id })
      );

      await f.app.nativeRuntime.runPromise(reopenedApi.acceptRestore(acceptance(retry)));
      await f.reopen();
      assert.strictEqual(f.app.store.db.orm.select().from(s.pages).all().length, 0);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'crash after replacement reconciles to new state before workers start; captured native work never resumes',
  { timeout: 60000 },
  async (t) => {
    const f = await backupFixture(t);

    try {
      const source = await inTestPhase(t, 'source-create', () =>
        f.app.nativeRuntime.runPromise(
          Effect.flatMap(Sources, (sources) =>
            sources.createSource({
              name: 'work.txt',
              bytes: Buffer.from('Native work input'),
              projectId: null
            })
          )
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

      const api = await inTestPhase(t, 'system-service', () => f.api());

      const backup = await inTestPhase(t, 'backup-create', () =>
        f.app.nativeRuntime.runPromise(api.createBackup())
      );

      // Live captured work remains owned and unchanged by backup preparation.
      assert.ok(db.select().from(s.workflow_executions).get()!.status === 'suspended');

      const preview = await inTestPhase(t, 'restore-preview', () =>
        f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }))
      );

      await inTestPhase(t, 'restore-accept', () =>
        f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)))
      );
      await inTestPhase(t, 'app-close-before-replacement', () => f.app.close());
      // Simulate process loss after atomic rename, before journal settlement.

      const old = Db.openSnapshot(f.location.path);

      await inTestPhase(t, 'previous-snapshot', () =>
        old.snapshot(f.location.path + '.backups/previous.sqlite')
      );
      console.debug('study-test-phase:replacement-sync:start');
      old.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
      old.close();
      renameSync(f.location.path + '.backups/restore.sqlite', f.location.path);
      console.debug('study-test-phase:replacement-sync:complete');
      await inTestPhase(t, 'reopen-after-replacement', () => f.reopen());

      console.debug('study-test-phase:retirement-assertions:start');

      const restored = f.app.store.db.orm;

      assert.ok(restored.select().from(s.workflow_executions).get()!.status === 'cancelled');
      assert.ok(restored.select().from(s.workflow_executions).get()!.owner_token === null);
      assert.strictEqual(restored.select().from(s.workflow_activities).all().length, 0);
      assert.strictEqual(restored.select().from(s.workflow_configuration_waits).all().length, 0);
      assert.ok(
        restored.select().from(s.workflow_retired_executions).get()!.execution_id === 'captured'
      );

      const nativeStore = workflowStore(f.app.store);

      const terminal = nativeStore.execution('captured');

      nativeStore.checkpoint('captured', 'old-owner', 'late result', 'completed');
      assert.throws(() =>
        nativeStore.saveActivity('captured', 'old-owner', 'late', 0, 'private checkpoint')
      );
      assert.ok(nativeStore.saveDeferred('captured', 'late', 'private completion') === false);
      expect(nativeStore.execution('captured')).toStrictEqual(terminal);
      console.debug('study-test-phase:retirement-assertions:complete');
      await inTestPhase(t, 'workers-start', () => f.app.workers.start());
      await inTestPhase(t, 'workers-stop', () => f.app.workers.stop());
      expect(f.requests).toStrictEqual([]);
      assert.strictEqual(restored.select().from(s.workflow_executions).all().length, 1);
      assert.ok(
        restored.select().from(s.sources).where(eq(s.sources.id, source.id)).get()!.name ===
          'work.txt'
      );
      assert.ok(
        (
          await inTestPhase(t, 'restore-status', async () =>
            f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())
          )
        ).state === 'applied'
      );
    } finally {
      await inTestPhase(t, 'test-finally', () => f.close());
    }
  }
);

testStable(
  'artifact deletion is bounded to an opaque managed identity and never removes live or external files',
  async () => {
    const f = await backupFixture();

    try {
      const api = await f.api();

      const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

      const external = join(f.location.dir, 'user-saved.studybackup');

      writeFileSync(external, 'External copy');
      assert.throws(() => Schema.decodeUnknownSync(backupIdSchema)('../user-saved'));

      const before = f.app.store.db.contentIdentity();

      await f.app.nativeRuntime.runPromise(api.deleteBackup({ id: backup.id }));
      assert.ok(readFileSync(external, 'utf8') === 'External copy');
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
      assert.strictEqual((await f.app.nativeRuntime.runPromise(api.backups())).length, 0);
    } finally {
      await f.close();
    }
  }
);
