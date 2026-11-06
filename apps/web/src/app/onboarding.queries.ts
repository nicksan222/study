import { mutationOptions } from '@tanstack/react-query';

import { updateAppSettings } from '#web/lib/study-client/operations.ts';

export const onboardingMutationOptions = () =>
  mutationOptions({ mutationFn: () => updateAppSettings({ onboarded: true }) });
