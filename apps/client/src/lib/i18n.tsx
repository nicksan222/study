import { createLocalization } from '@study/localization';
import type { Locale } from '@study/localization';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
export type { Locale } from '@study/localization';

const LanguageContext = createContext(createLocalization('english'));

const LanguageActionsContext = createContext<{ setLocale: (locale: Locale) => void }>({
  setLocale: () => {}
});

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [savedLocale, setLocale] = useState<Locale>();
  const selected = savedLocale ?? locale;
  const localization = useMemo(() => createLocalization(selected), [selected]);
  const actions = useMemo(() => ({ setLocale }), []);

  useEffect(() => {
    document.documentElement.lang = selected === 'italian' ? 'it' : 'en';
  }, [selected]);

  return (
    <LanguageActionsContext.Provider value={actions}>
      <LanguageContext.Provider value={localization}>{children}</LanguageContext.Provider>
    </LanguageActionsContext.Provider>
  );
}

export function useI18n() {
  return useContext(LanguageContext);
}

export function useLanguage() {
  return useContext(LanguageActionsContext);
}
