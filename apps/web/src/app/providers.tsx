import { Language } from '@study/contracts/settings/types';
import { ToastProvider } from '@study/ui/toast';
import { TooltipProvider } from '@study/ui/tooltip';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import type { Locale } from '../lib/i18n';
import { LanguageProvider, useLanguage, useI18n } from '../lib/i18n';
import { appSettingsQueryOptions } from '../lib/study-client/preferences.queries';
import { BackupNotifications } from '../pages/settings/data/notifications';
import { OnboardingProvider } from './onboarding';

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
      <TooltipProvider>
        <LanguageProvider locale={locale}>
          <SavedLanguage />
          <Notifications>
            <OnboardingProvider>{children}</OnboardingProvider>
          </Notifications>
        </LanguageProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function SavedLanguage() {
  const { data } = useQuery(appSettingsQueryOptions());
  const { setLocale } = useLanguage();

  useEffect(() => {
    if (data) setLocale(data.language === Language.ITALIAN ? 'italian' : 'english');
  }, [data, setLocale]);

  return null;
}

function Notifications({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <ToastProvider closeLabel={t('Close')} viewportLabel={t('NotificationsLabel')}>
      <BackupNotifications />
      {children}
    </ToastProvider>
  );
}
