import type { ProjectId } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies project validation, lookup semantics, pagination, and mutations through   │
 * │ the feature service.                                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises projects enforce validation, distinguish missing records and page            │
 * │   accurately.                                                                            │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Layer, Option } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Projects } from './index.ts';

test.stable(
  'projects enforce validation, distinguish missing records and page accurately',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Projects.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const absent = 99999n as ProjectId;

          test.assert.ok(Option.isNone(yield* projects.findProject(absent)));
          test.assert.ok((yield* Effect.flip(projects.project(absent))).kind === 'not_found');
          const first = yield* projects.createProject({ name: ' Physics ' });
          const second = yield* projects.createProject({ name: '😀'.repeat(100) });

          test.assert.ok(first.name === 'Physics');
          const page = yield* projects.projects({ limit: 1 });

          test.assert.strictEqual(page.next, second.id);
          test.assert.ok((yield* projects.projects({ limit: 1, before: second.id })).next === null);
          test.assert.ok(
            (yield* Effect.flip(projects.renameProject({ id: first.id, name: '😀'.repeat(101) })))
              .kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(projects.setExam({ id: first.id, examOn: '2025-2-29' }))).kind ===
              'invalid_input'
          );
          test.assert.ok((yield* projects.project(first.id)).name === 'Physics');
          test.assert.strictEqual(
            yield* projects.setExam({ id: first.id, examOn: '2024-2-29' }),
            true
          );
          test.assert.ok((yield* projects.project(first.id)).examOn === '2024-02-29');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'large project IDs survive reads and deletion cascades, while constraints roll back',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Projects.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

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

          test.assert.strictEqual((yield* projects.project(id)).id, id);
          const created = yield* projects.createProject({ name: 'Next' });

          test.assert.strictEqual(created.id, 9007199254740994n);
          test.assert.strictEqual(
            (yield* projects.projects({ limit: 1, before: created.id })).items[0]?.id,
            id
          );
          context.db.orm.run(
            sql`CREATE TRIGGER reject_rename BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          yield* Effect.flip(projects.renameProject({ id, name: 'New' }));
          test.assert.ok((yield* projects.project(id)).name === 'Large');
          test.assert.strictEqual(yield* projects.deleteProject({ id }), true);
          test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM sources`).length, 1);
        }).pipe(Effect.provide(layer))
      );
      test.assert.throws(() =>
        context.db.orm.run(
          sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('', 1, 1)`
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
