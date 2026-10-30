import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { Locale } from '../lib/i18n';
import { LanguageProvider } from '../lib/i18n';

export function Providers({
  children,
  queryClient,
  locale = 'english'
}: {
  children: ReactNode;
  queryClient: QueryClient;
  locale?: Locale;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider locale={locale}>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}
