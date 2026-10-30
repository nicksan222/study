import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';

import { Themes } from '#server/features/themes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

test('themes catalog, mutations and selection preserve transactional rules', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Themes.layer.pipe(Layer.provide(Layer.succeed(Database, { store: context })));
  const json = (id: string, name = id) =>
    JSON.stringify({ version: 1, id, name, colors: { primary: ' red ' } });

  try {
    context.db.orm.run(sql`DELETE FROM themes`);
    await Effect.runPromise(
      Effect.gen(function* () {
        const themes = yield* Themes;

        assert.ok(Option.isNone(yield* themes.findTheme('missing')));
        assert.equal((yield* Effect.flip(themes.theme('missing'))).kind, 'not_found');
        yield* themes.importTheme({ json: json('a') });
        yield* themes.importTheme({ json: json('b') });
        assert.equal(
          (yield* Effect.flip(themes.importTheme({ json: json('a') }))).kind,
          'invalid_input'
        );
        assert.equal((yield* themes.saveTheme({ json: json('a', 'Changed') })).name, 'Changed');
        const page = yield* themes.themes({ limit: 1 });

        assert.equal(page.items[0]?.id, 'a');
        assert.equal(page.next, 'a');
        assert.equal((yield* themes.themes({ limit: 1, before: 'a' })).next, null);
        assert.equal(JSON.parse(yield* themes.exportTheme({ id: 'a' })).colors.primary, 'red');
        assert.equal(
          (yield* Effect.flip(
            themes.importTheme({ json: json('bad').replace(' red ', 'nonsense') })
          )).kind,
          'invalid_input'
        );
        yield* themes.selectTheme({ id: 'a' });
        assert.equal((yield* Effect.flip(themes.selectTheme({ id: 'missing' }))).kind, 'not_found');
        assert.equal(yield* themes.selectedTheme(), 'a');
        context.db.orm.run(
          sql`CREATE TRIGGER reject_selection BEFORE UPDATE ON preferences WHEN NEW.scope = 'theme' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(themes.deleteTheme({ id: 'a' }));
        assert.equal((yield* themes.theme('a')).id, 'a');
        assert.equal(yield* themes.selectedTheme(), 'a');
        context.db.orm.run(sql`DROP TRIGGER reject_selection`);
        yield* themes.deleteTheme({ id: 'a' });
        assert.equal(yield* themes.selectedTheme(), null);
        context.db.orm.run(sql`UPDATE themes SET builtin = 1 WHERE id = 'b'`);
        assert.equal(
          (yield* Effect.flip(themes.saveTheme({ json: json('b') }))).kind,
          'invalid_input'
        );
        assert.equal((yield* Effect.flip(themes.deleteTheme({ id: 'b' }))).kind, 'invalid_input');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
