import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectId } from '@study/contracts/ids';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Projects } from './index.ts';

test('projects enforce validation, distinguish missing records and page accurately', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Projects.layer.pipe(Layer.provide(Layer.succeed(Database, { store: context })));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const absent = 99999n as ProjectId;

        assert.ok(Option.isNone(yield* projects.findProject(absent)));
        assert.equal((yield* Effect.flip(projects.project(absent))).kind, 'not_found');
        const first = yield* projects.createProject({ name: ' Physics ' });
        const second = yield* projects.createProject({ name: '😀'.repeat(100) });

        assert.equal(first.name, 'Physics');
        const page = yield* projects.projects({ limit: 1 });

        assert.equal(page.next, second.id);
        assert.equal((yield* projects.projects({ limit: 1, before: second.id })).next, null);
        assert.equal(
          (yield* Effect.flip(projects.renameProject({ id: first.id, name: '😀'.repeat(101) })))
            .kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(projects.setExam({ id: first.id, examOn: '2025-2-29' }))).kind,
          'invalid_input'
        );
        assert.equal((yield* projects.project(first.id)).name, 'Physics');
        assert.equal(yield* projects.setExam({ id: first.id, examOn: '2024-2-29' }), true);
        assert.equal((yield* projects.project(first.id)).examOn, '2024-02-29');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('large project IDs survive reads and deletion cascades, while constraints roll back', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Projects.layer.pipe(Layer.provide(Layer.succeed(Database, { store: context })));

  try {
    const { sql } = await import('@study/db');

    context.db.orm.run(
      sql`INSERT INTO projects (id, name, created_at, updated_at) VALUES (9007199254740993, 'Large', 1, 1)`
    );
    context.db.orm.run(
      sql`INSERT INTO sources (project_id, origin, kind, mime, name, size_bytes, sha256, created_at) VALUES (9007199254740993, 'attachment', 'text', 'text/plain', 'file', 1, zeroblob(32), 1)`
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const id = 9007199254740993n as ProjectId;

        assert.equal((yield* projects.project(id)).id, id);
        const created = yield* projects.createProject({ name: 'Next' });

        assert.equal(created.id, 9007199254740994n);
        assert.equal((yield* projects.projects({ limit: 1, before: created.id })).items[0]?.id, id);
        context.db.orm.run(
          sql`CREATE TRIGGER reject_rename BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(projects.renameProject({ id, name: 'New' }));
        assert.equal((yield* projects.project(id)).name, 'Large');
        assert.equal(yield* projects.deleteProject({ id }), true);
        assert.equal(context.db.orm.all(sql`SELECT * FROM sources`).length, 0);
      }).pipe(Effect.provide(layer))
    );
    assert.throws(() =>
      context.db.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('', 1, 1)`)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
