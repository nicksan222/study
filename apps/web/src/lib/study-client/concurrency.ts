import type { ConcurrencySettings } from '@study/contracts/settings/types';

import { request } from './request';

export const loadConcurrencySettings = (signal?: AbortSignal) =>
  request((client) => client['settings.concurrencySettings']({}), signal);

export const saveConcurrencySettings = (settings: ConcurrencySettings) =>
  request((client) => client['settings.saveConcurrencySettings'](settings));
