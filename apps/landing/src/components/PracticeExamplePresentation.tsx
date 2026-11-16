import { createPracticePresentation } from '@study/localization';
import { PracticePresentationProvider } from '@study/ui/practice-presentation';
import type { ReactNode } from 'react';

export function PracticeExamplePresentation({
  lang,
  children
}: {
  lang: 'en' | 'it';
  children: ReactNode;
}) {
  const locale = lang === 'it' ? 'italian' : 'english';

  return (
    <PracticePresentationProvider value={createPracticePresentation(locale)}>
      {children}
    </PracticePresentationProvider>
  );
}
