import { mutationOptions } from '@tanstack/react-query';

import { updateAppSettings } from '#client/lib/study-client/operations.ts';

export const onboardingMutationOptions = () =>
  mutationOptions({ mutationFn: () => updateAppSettings({ onboarded: true }) });
