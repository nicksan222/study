import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestDatabase } from '@study/db/testing';
import { Effect } from 'effect';

import { Auth } from '#server/features/auth/index';
import { AuthStore } from '#server/features/auth/store/index';
import { Settings } from '#server/features/settings/index';
import { Agents } from '#server/platform/ai/agents';
import { encodeAccount } from '#server/platform/ai/auth/index';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { App } from '#server/runtime/index';

test('same-account credential replacement changes the durable nonsecret fingerprint', async () => {
  const location = createTestDatabase();
  let app = await App.open({ path: location.path });
  let savedRevision = '';

  try {
    await app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const configuration = yield* WorkflowConfiguration;
        const auth = yield* Auth;
        const account = encodeAccount({
          subject: 'same',
          clientId: 'client',
          refreshToken: 'private-token',
          sharing: true
        });

        yield* transaction((tx) => tx.store(AuthStore).saveAccount(account)).pipe(
          Effect.provideService(Database, { store: app.store })
        );
        const before = yield* configuration.revision;
        const publicAccount = yield* auth.publicAccount();

        yield* transaction((tx) => tx.store(AuthStore).saveAccount(account)).pipe(
          Effect.provideService(Database, { store: app.store })
        );
        savedRevision = yield* configuration.revision;

        assert.notEqual(savedRevision, before);
        assert.deepEqual(yield* auth.publicAccount(), publicAccount);
        assert.match(savedRevision, /^[a-f0-9]{64}$/);
        assert.ok(!savedRevision.includes('private-token'));
      })
    );
    await app.close();
    app = await App.open({ path: location.path });
    assert.equal(
      await app.nativeRuntime.runPromise(
        Effect.flatMap(WorkflowConfiguration, (configuration) => configuration.revision)
      ),
      savedRevision
    );
  } finally {
    await app.close();
    location.cleanup();
  }
});

test('shared agent instructions resolve the current application language per operation', async () => {
  const location = createTestDatabase();
  const app = await App.open({ path: location.path });

  try {
    await app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const agents = yield* Agents;
        const settings = yield* Settings;
        const language = () =>
          typeof agents.language === 'string' ? Effect.succeed(agents.language) : agents.language;

        assert.equal(yield* language(), 'english');
        const current = yield* settings.appSettings();

        yield* settings.saveAppSettings({ ...current, language: 2 });
        assert.equal(yield* language(), 'italian');
      })
    );
  } finally {
    await app.close();
    location.cleanup();
  }
});
