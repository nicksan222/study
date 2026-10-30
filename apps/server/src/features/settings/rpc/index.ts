import type { StudyError } from '@study/contracts/errors';
import { SettingsRpc } from '@study/contracts/settings/rpc';
import { Effect } from 'effect';

import { Settings } from '#server/features/settings/service/index';

const mappedStudyError = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const SettingsRpcLive = SettingsRpc.toLayer(
  Effect.gen(function* () {
    const settings = yield* Settings;

    return {
      'settings.appSettings': () => settings.appSettings().pipe(Effect.mapError(mappedStudyError)),
      'settings.llmSettings': () => settings.llmSettings().pipe(Effect.mapError(mappedStudyError)),
      'settings.materialSettings': () =>
        settings.materialSettings().pipe(Effect.mapError(mappedStudyError)),
      'settings.reviewSettings': () =>
        settings.reviewSettings().pipe(Effect.mapError(mappedStudyError)),
      'settings.saveAppSettings': (input) =>
        settings.saveAppSettings(input).pipe(Effect.mapError(mappedStudyError)),
      'settings.saveLlmSettings': (input) =>
        settings.saveLlmSettings(input).pipe(Effect.mapError(mappedStudyError)),
      'settings.saveMaterialSettings': (input) =>
        settings.saveMaterialSettings(input).pipe(Effect.mapError(mappedStudyError)),
      'settings.saveReviewSettings': (input) =>
        settings.saveReviewSettings(input).pipe(Effect.mapError(mappedStudyError))
    };
  })
);
