/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises real speech ingestion through workflow publication and SQLite.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies real speech becomes retained searchable source evidence.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated application data and explicitly installed real model assets.               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { installModelAssets } from '#server/platform/ai/model-assets';
import { vozModel } from '#server/platform/ai/speech/model';
import { App } from '#server/runtime/index';

testStable(
  'real Voz ingestion commits a searchable timestamped extraction through the running workflow consumer',
  async () => {
    const models = resolve('target/speech-model/voz');

    await Effect.runPromise(installModelAssets(models, vozModel));
    const directory = await mkdtemp(join(tmpdir(), 'study-voice-workflow-'));

    await mkdir(join(directory, 'models'));
    await symlink(models, join(directory, 'models', 'voz-v0.5.0'), 'junction');
    const app = await App.open({ path: join(directory, 'study.sqlite') });

    try {
      await app.workers.start();
      const bytes = await readFile(
        new URL('../../../platform/ai/speech/fixtures/lecture.wav', import.meta.url)
      );
      const id = await app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...(yield* settings.workspacePreferences()),
            autoTranscribeAudio: true
          });
          const sources = yield* Sources;

          return (yield* sources.createSource({ name: 'lecture.wav', bytes, projectId: null })).id;
        })
      );

      await expect
        .poll(
          () =>
            app.nativeRuntime.runPromise(
              Effect.flatMap(Sources, (sources) => sources.currentExtraction({ id }))
            ),
          { timeout: 30000 }
        )
        .not.toBeNull();
      const extraction = await app.nativeRuntime.runPromise(
        Effect.flatMap(Sources, (sources) => sources.currentExtraction({ id }))
      );

      expect(extraction!.document.blocks[0]!.text.toLowerCase()).toContain(
        'capital of italy is rome'
      );
      expect(extraction!.document.meta.extractor).toBe('transcription');
      expect(extraction!.document.blocks[0]!.anchor.type).toBe('time');
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

testStable('installing Voz resumes an automatic import waiting for the model', async () => {
  const models = resolve('target/speech-model/voz');

  await Effect.runPromise(installModelAssets(models, vozModel));
  const directory = await mkdtemp(join(tmpdir(), 'study-voice-install-'));
  const app = await App.open({ path: join(directory, 'study.sqlite') });

  try {
    await app.workers.start();
    const bytes = await readFile(
      new URL('../../../platform/ai/speech/fixtures/lecture.wav', import.meta.url)
    );
    const id = await app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;

        yield* settings.saveWorkspacePreferences({
          ...(yield* settings.workspacePreferences()),
          autoTranscribeAudio: true
        });

        return (yield* (yield* Sources).createSource({
          name: 'waiting.wav',
          bytes,
          projectId: null
        })).id;
      })
    );

    await expect
      .poll(
        () =>
          app.store.db.orm.get<{ n: bigint }>(
            sql`SELECT count(*) n FROM workflow_configuration_waits`
          )!.n,
        { timeout: 10000 }
      )
      .toBe(1n);
    await mkdir(join(directory, 'models'));
    await symlink(models, join(directory, 'models', 'voz-v0.5.0'), 'junction');
    await app.nativeRuntime.runPromise(
      Effect.flatMap(Sources, (sources) => sources.installTranscriptionModel())
    );
    await expect
      .poll(
        () =>
          app.nativeRuntime.runPromise(
            Effect.flatMap(Sources, (sources) => sources.currentExtraction({ id }))
          ),
        { timeout: 20000 }
      )
      .not.toBeNull();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
