import { useI18n } from '@study/client/companion';
import { ClientSlot } from '@study/client/extensions';
import { MobileStudy } from '@study/ui';
import { useContext } from 'react';

import { MobileTransport } from '#mobile/features/pairing/session.ts';
import { MobileCapture } from '#mobile/features/quick-capture/capture.tsx';
import { CaptureSaveState } from '#mobile/features/quick-capture/state.ts';

export function CapturePage() {
  const { t } = useI18n();
  const transport = useContext(MobileTransport)!;
  const { status } = useContext(CaptureSaveState)!;

  return (
    <MobileStudy.Screen>
      <MobileStudy.Header title={t('MobileCaptureTitle')}>
        <p>{t('MobileCaptureIntro')}</p>
      </MobileStudy.Header>
      <MobileCapture transport={transport} />
      <ClientSlot name="capture.actions" props={{ busy: status === 'sending' }} />
    </MobileStudy.Screen>
  );
}
