import type { ProtocolTransport } from '@study/contracts/react';
import { RpcProvider, configureRpcTransport, rpc } from '@study/contracts/react';
import { Language } from '@study/contracts/settings/types';
import { ToastProvider } from '@study/ui/toast';
import { TooltipProvider } from '@study/ui/tooltip';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { AssistantProvider } from '#client/features/assistant/index.ts';

import { createRpcTransport } from '../lib/effect/rpc';
import type { Locale } from '../lib/i18n';
import { LanguageProvider, useLanguage, useI18n } from '../lib/i18n';

const defaultTransport = createRpcTransport();

configureRpcTransport(defaultTransport);
import { BackupNotifications } from '../pages/settings/data/notifications';
import { OnboardingProvider } from './onboarding';

export function Providers({
  children,
  transport = defaultTransport,
  locale = 'english',
  renderApp = (content) => content
}: {
  children: ReactNode;
  transport?: ProtocolTransport;
  locale?: Locale;
  renderApp?: (content: ReactNode) => ReactNode;
}) {
  return (
    <RpcProvider transport={transport}>
      <TooltipProvider>
        <LanguageProvider locale={locale}>
          {renderApp(
            <>
              <SavedLanguage />
              <Notifications>
                <AssistantProvider>
                  <OnboardingProvider>{children}</OnboardingProvider>
                </AssistantProvider>
              </Notifications>
            </>
          )}
        </LanguageProvider>
      </TooltipProvider>
    </RpcProvider>
  );
}

function SavedLanguage() {
  const { data } = rpc.settings.appSettings.useQuery({});
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
