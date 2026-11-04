import type { Language } from '@study/contracts/settings/types';
import { mutationOptions } from '@tanstack/react-query';

import { saveLanguage } from '#web/lib/study-client/preferences.ts';

export const languageMutationOptions = () =>
  mutationOptions({ mutationFn: (language: Language) => saveLanguage(language) });
