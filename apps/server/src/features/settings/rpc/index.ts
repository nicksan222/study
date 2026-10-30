import { SettingsRpc } from '@study/contracts/settings/rpc';
import { Effect } from 'effect';

import { Settings } from '#server/features/settings/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SettingsRpcLive = defineRpc(
  SettingsRpc,
  Effect.gen(function* () {
    const settings = yield* Settings;

    return {
      'settings.appSettings': () => settings.appSettings(),
      'settings.llmSettings': () => settings.llmSettings(),
      'settings.materialSettings': () => settings.materialSettings(),
      'settings.reviewSettings': () => settings.reviewSettings(),
      'settings.saveAppSettings': (input) => settings.saveAppSettings(input),
      'settings.saveLlmSettings': (input) => settings.saveLlmSettings(input),
      'settings.saveMaterialSettings': (input) => settings.saveMaterialSettings(input),
      'settings.saveReviewSettings': (input) => settings.saveReviewSettings(input)
    };
  })
);
