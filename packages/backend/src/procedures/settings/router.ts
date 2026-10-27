import { router } from '#backend/runtime/trpc';

import { run as getAppSettings } from './get-app-settings.ts';
import { run as getLlmSettings } from './get-llm-settings.ts';
import { run as getMaterialSettings } from './get-material-settings.ts';
import { run as getReviewSettings } from './get-review-settings.ts';
import { run as saveAppSettings } from './save-app-settings.ts';
import { run as saveLlmSettings } from './save-llm-settings.ts';
import { run as saveMaterialSettings } from './save-material-settings.ts';
import { run as saveReviewSettings } from './save-review-settings.ts';

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
