/* eslint-disable study/database-ownership -- Upgrade fixture must open the old schema with the official migrator. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { workflowEventSchema } from '@study/contracts/events';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { Schema } from 'effect';

import { Db } from '../src/index.ts';
import { material_source_snapshots, source_processing, source_snapshots } from '../src/schema.ts';

test('upgrading existing sources captures their current input and retains their last document', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-source-upgrade-'));
  const path = join(directory, 'study.db');
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const oldMigrations = join(directory, 'old-migrations');
  const input = Buffer.from('Existing notes');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029173029_fixed_khan')
        cpSync(join(migrations, entry), join(oldMigrations, entry), { recursive: true });
    }

    const sqlite = new DatabaseSync(path, { readBigInts: true });

    try {
      const old = drizzle({ client: sqlite });

      migrate(old, { migrationsFolder: oldMigrations });
      old.run(
        sql`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES (1,'attachment','text','text/plain','Existing notes',${BigInt(input.length)},${Buffer.alloc(32)},1)`
      );
      old.run(sql`INSERT INTO source_blobs(source_id,bytes) VALUES (1,${input})`);
      old.run(
        sql`INSERT INTO projects(id,name,created_at,updated_at) VALUES (1,'Old project',1,1)`
      );
      old.run(sql`UPDATE sources SET project_id=1 WHERE id=1`);
      old.run(
        sql`INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES (1,1,'file','Old file',1,1)`
      );
      old.run(
        sql`INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES (1,1,1,'file',1,1)`
      );
      old.run(sql`INSERT INTO material_file_versions(version_id,source_id) VALUES (1,1)`);
      old.run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=1`);
      old.run(
        sql`INSERT INTO documents(id,source_id,extractor_version,meta,created_at) VALUES (1,1,1,'{}',1)`
      );
    } finally {
      sqlite.close();
    }

    const upgraded = Db.open(path);

    try {
      const state = upgraded.orm.select().from(source_processing).get();
      const snapshot = upgraded.orm.select().from(source_snapshots).get();

      assert.equal(state?.revision, 1n);
      assert.equal(state?.document_id, 1n);
      assert.ok(state?.request_id);
      assert.equal(state.published_request_id, state.request_id);
      assert.deepEqual(snapshot?.bytes, input);
      const pin = upgraded.orm.select().from(material_source_snapshots).get();

      assert.equal(pin?.revision, 1n);
      assert.deepEqual(JSON.parse(pin!.metadata), {
        id: '1',
        name: 'Existing notes',
        kind: 'text',
        mime: 'text/plain',
        origin: 'attachment',
        projectId: '1',
        projectName: 'Old project',
        sizeBytes: String(input.length),
        sha256: '00'.repeat(32),
        uri: null,
        createdAt: '1'
      });
      assert.equal(snapshot?.kind, 'text');
      assert.equal(snapshot?.mime, 'text/plain');
      assert.deepEqual(upgraded.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      upgraded.close();
    }

    const reopened = Db.open(path);

    try {
      assert.equal(reopened.orm.select().from(source_snapshots).all().length, 1);
      assert.equal(reopened.orm.select().from(material_source_snapshots).all().length, 1);
      assert.equal(reopened.orm.select().from(source_processing).all().length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrade reconciles changed current bytes without overwriting an earlier snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-source-repair-'));
  const path = join(directory, 'study.db');
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const oldMigrations = join(directory, 'old-migrations');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029194323_friendly_vampiro')
        cpSync(join(migrations, entry), join(oldMigrations, entry), { recursive: true });
    }

    const sqlite = new DatabaseSync(path, { readBigInts: true });

    try {
      const old = drizzle({ client: sqlite });

      migrate(old, { migrationsFolder: oldMigrations });
      sqlite.exec(`
        INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
        INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,1,'attachment','text','text/plain','current.txt',1,zeroblob(32),1);
        INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01');
        INSERT INTO source_processing(source_id,revision,request_id) VALUES(1,1,'original');
        INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,X'01','text','text/plain');
        UPDATE source_blobs SET bytes=X'02' WHERE source_id=1;
        INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES(1,1,'file','Published',1,1);
        INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(1,1,1,'file',1,1);
        INSERT INTO material_file_versions(version_id,source_id) VALUES(1,1);
        UPDATE material_versions SET status='published',published_at=2 WHERE id=1;
      `);
    } finally {
      sqlite.close();
    }

    const upgraded = Db.open(path);

    try {
      const snapshots = upgraded.orm.select().from(source_snapshots).all();

      assert.equal(snapshots.length, 2);
      assert.deepEqual(snapshots.find((s) => s.revision === 1n)?.bytes, Buffer.from([1]));
      const pin = upgraded.orm.select().from(material_source_snapshots).get()!;

      assert.equal(pin.revision, 2n);
      assert.deepEqual(snapshots.find((s) => s.revision === pin.revision)?.bytes, Buffer.from([2]));
      assert.equal(upgraded.orm.select().from(source_processing).get()?.revision, 2n);
      const events = upgraded.orm.all(
        sql`SELECT payload FROM workflow_events WHERE type='SourceProcessingRequested'`
      );

      assert.equal(events.length, 1);
      const event = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.toCodecJson(workflowEventSchema))
      )(events[0]!.payload);

      assert.equal(event.type, 'SourceProcessingRequested');
      assert.equal(event.inputVersion, 2);

      if (event.type === 'SourceProcessingRequested') assert.equal(event.sourceId, 1n);

      assert.deepEqual(upgraded.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrade preserves captured media metadata when the current source changes with identical bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-source-metadata-repair-'));
  const path = join(directory, 'study.db');
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const oldMigrations = join(directory, 'old-migrations');

  try {
    for (const entry of readdirSync(migrations)) {
      if (entry < '20261029174901_initialize-source-state')
        cpSync(join(migrations, entry), join(oldMigrations, entry), { recursive: true });
    }

    const sqlite = new DatabaseSync(path, { readBigInts: true });

    try {
      migrate(drizzle({ client: sqlite }), { migrationsFolder: oldMigrations });
      sqlite.exec(`
        INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,'attachment','image','image/png','current.png',1,zeroblob(32),1);
        INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01');
        INSERT INTO source_processing(source_id,revision,request_id) VALUES(1,1,'captured-audio');
        INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,X'01','audio','audio/wav');
      `);
    } finally {
      sqlite.close();
    }

    const upgraded = Db.open(path);

    try {
      const snapshots = upgraded.orm.select().from(source_snapshots).all();

      assert.equal(snapshots.length, 2);
      const captured = snapshots.find((s) => s.revision === 1n)!;
      const repaired = snapshots.find((s) => s.revision === 2n)!;

      assert.equal(captured.kind, 'audio');
      assert.equal(captured.mime, 'audio/wav');
      assert.equal(repaired.kind, 'image');
      assert.equal(repaired.mime, 'image/png');
      assert.deepEqual(captured.bytes, repaired.bytes);
      const state = upgraded.orm.select().from(source_processing).get()!;

      assert.equal(state.revision, 2n);
      assert.notEqual(state.request_id, 'captured-audio');
      assert.equal(
        upgraded.orm.all(sql`SELECT * FROM workflow_events WHERE type='SourceProcessingRequested'`)
          .length,
        1
      );
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
