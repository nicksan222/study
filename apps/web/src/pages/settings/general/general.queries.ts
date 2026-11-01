import type { Language } from '@study/contracts/settings/types';
import { mutationOptions } from '@tanstack/react-query';

import { saveLanguage } from '../../../lib/study-client/preferences';

export const languageMutationOptions = () =>
  mutationOptions({ mutationFn: (language: Language) => saveLanguage(language) });
