import { createPracticePresentation } from '@study/localization';
import { PracticePresentationProvider } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export function ClientPracticePresentation({ children }: { children: ReactNode }) {
  const { locale } = useI18n();

  return (
    <PracticePresentationProvider value={createPracticePresentation(locale)}>
      {children}
    </PracticePresentationProvider>
  );
}
