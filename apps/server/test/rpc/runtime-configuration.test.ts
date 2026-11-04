/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks durable configuration fingerprints change when same-account credentials are │
 * │ replaced without exposing secrets, survive application reopen, and follow current        │
 * │ language settings per operation.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: same-account credential replacement changes the durable nonsecret             │
 * │   fingerprint; shared agent instructions resolve the current application language per    │
 * │   operation.                                                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/features/auth/index, #server/features/auth/store/index,                     │
 * │ #server/features/settings/index with real SQLite and application resources; fixture      │
 * │ cleanup closes owned resources.                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Auth } from '#server/features/auth/index';
import { AuthStore } from '#server/features/auth/store/index';
import { Settings } from '#server/features/settings/index';
import { Agents } from '#server/platform/ai/agents';
import { encodeAccount } from '#server/platform/ai/auth/index';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { App } from '#server/runtime/index';

testStable(
  'same-account credential replacement changes the durable nonsecret fingerprint',
  async () => {
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

          assert.notStrictEqual(savedRevision, before);
          expect(yield* auth.publicAccount()).toStrictEqual(publicAccount);
          expect(savedRevision).toMatch(/^[a-f0-9]{64}$/);
          assert.ok(!savedRevision.includes('private-token'));
        })
      );
      await app.close();
      app = await App.open({ path: location.path });
      assert.strictEqual(
        await app.nativeRuntime.runPromise(
          Effect.flatMap(WorkflowConfiguration, (configuration) => configuration.revision)
        ),
        savedRevision
      );
    } finally {
      await app.close();
      location.cleanup();
    }
  }
);

testStable(
  'shared agent instructions resolve the current application language per operation',
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });

    try {
      await app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const agents = yield* Agents;
          const settings = yield* Settings;
          const language = () =>
            typeof agents.language === 'string' ? Effect.succeed(agents.language) : agents.language;

          assert.strictEqual(yield* language(), 'english');
          const current = yield* settings.appSettings();

          yield* settings.saveAppSettings({ ...current, language: 2 });
          assert.strictEqual(yield* language(), 'italian');
        })
      );
    } finally {
      await app.close();
      location.cleanup();
    }
  }
);
