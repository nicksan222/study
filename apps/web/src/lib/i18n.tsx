import { createLocalization } from '@study/localization';
import type { Locale } from '@study/localization';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
export type { Locale, MessageKey, StaticMessageKey } from '@study/localization';

const LanguageContext = createContext(createLocalization('english'));

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const localization = useMemo(() => createLocalization(locale), [locale]);

  return <LanguageContext.Provider value={localization}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  return useContext(LanguageContext);
}
