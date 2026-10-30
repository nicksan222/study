import type { ReactNode } from 'react';

import { LanguageProvider } from '../lib/i18n';

export function Providers({ children }: { children: ReactNode }) {
  return <LanguageProvider locale="english">{children}</LanguageProvider>;
}
