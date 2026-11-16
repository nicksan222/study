import { sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks theme catalog paging, serialization, selection, and transactional mutation  │
 * │ rules.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises themes catalog, mutations and selection preserve transactional rules.        │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Layer, Option } from 'effect';

import { Themes } from '#server/features/themes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

test.stable(
  'themes catalog, mutations and selection preserve transactional rules',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Themes.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const json = (id: string, name = id) =>
      JSON.stringify({ version: 1, id, name, colors: { primary: ' red ' } });

    try {
      context.db.orm.run(sql`DELETE FROM themes`);
      await Effect.runPromise(
        Effect.gen(function* () {
          const themes = yield* Themes;

          test.assert.ok(Option.isNone(yield* themes.findTheme('missing')));
          test.assert.ok((yield* Effect.flip(themes.theme('missing'))).kind === 'not_found');
          yield* themes.importTheme({ json: json('a') });
          yield* themes.importTheme({ json: json('b') });
          test.assert.ok(
            (yield* Effect.flip(themes.importTheme({ json: json('a') }))).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* themes.saveTheme({ json: json('a', 'Changed') })).name === 'Changed'
          );
          const page = yield* themes.themes({ limit: 1 });

          test.assert.ok(page.items[0]?.id === 'a');
          test.assert.ok(page.items[0]?.builtin === false);
          test.assert.ok(page.next === 'a');
          test.assert.ok((yield* themes.themes({ limit: 1, before: 'a' })).next === null);
          test.assert.ok(
            JSON.parse(yield* themes.exportTheme({ id: 'a' })).colors.primary === 'red'
          );
          test.assert.ok(
            (yield* Effect.flip(
              themes.importTheme({ json: json('bad').replace(' red ', 'nonsense') })
            )).kind === 'invalid_input'
          );
          yield* themes.selectTheme({ id: 'a' });
          test.assert.ok(
            (yield* Effect.flip(themes.selectTheme({ id: 'missing' }))).kind === 'not_found'
          );
          test.assert.strictEqual(yield* themes.selectedTheme(), 'a');
          context.db.orm.run(
            sql`CREATE TRIGGER reject_selection BEFORE UPDATE ON preferences WHEN NEW.scope = 'theme' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          yield* Effect.flip(themes.deleteTheme({ id: 'a' }));
          test.assert.ok((yield* themes.theme('a')).id === 'a');
          test.assert.strictEqual(yield* themes.selectedTheme(), 'a');
          context.db.orm.run(sql`DROP TRIGGER reject_selection`);
          yield* themes.deleteTheme({ id: 'a' });
          test.assert.strictEqual(yield* themes.selectedTheme(), null);
          context.db.orm.run(sql`UPDATE themes SET builtin = 1 WHERE id = 'b'`);
          test.assert.ok((yield* themes.themes({ limit: 100 })).items[0]?.builtin === true);
          test.assert.ok(
            (yield* Effect.flip(themes.saveTheme({ json: json('b') }))).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(themes.deleteTheme({ id: 'b' }))).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
