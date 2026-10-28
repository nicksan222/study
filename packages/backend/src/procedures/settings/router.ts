import { router } from '#backend/runtime/trpc';

import { run as getAppSettings } from './get-app-settings/index.ts';
import { run as getLlmSettings } from './get-llm-settings/index.ts';
import { run as getMaterialSettings } from './get-material-settings/index.ts';
import { run as getReviewSettings } from './get-review-settings/index.ts';
import { run as saveAppSettings } from './save-app-settings/index.ts';
import { run as saveLlmSettings } from './save-llm-settings/index.ts';
import { run as saveMaterialSettings } from './save-material-settings/index.ts';
import { run as saveReviewSettings } from './save-review-settings/index.ts';

export const settingsRouter = router({
  getMaterialSettings,
  saveMaterialSettings,
  getAppSettings,
  saveAppSettings,
  getLlmSettings,
  saveLlmSettings,
  getReviewSettings,
  saveReviewSettings
});
