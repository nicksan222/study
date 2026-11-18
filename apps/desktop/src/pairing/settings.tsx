import {
  desktopState,
  disconnectDesktop,
  resumeDesktop,
  startInvitation,
  subscribeDesktop,
  useI18n
} from '@study/client/companion';
import { Button, ErrorState, MobileStudy, RetryButton, Settings } from '@study/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';

const pairingSteps = [
  ['MobileScanTitle', 'MobileScanDescription'],
  ['MobileMatchTitle', 'MobileMatchDescription'],
  ['MobileAvailabilityTitle', 'MobileAvailabilityDescription']
] as const;

export function DesktopMobileSettings() {
  const { t } = useI18n();
  const state = useSyncExternalStore(subscribeDesktop, desktopState);
  const hasPairing = !!state.link || state.revocationPending;

  return (
    <Settings.Section title={t('MobileStudy')}>
      <MobileStudy.Stack>
        <PairingIntroduction state={state} />
        {state.invite && (
          <InvitationDetails key={state.invite} invite={state.invite} approval={state.approval} />
        )}
        {state.revocationPending ? (
          <ErrorState title={t('MobileRevocationError')} />
        ) : (
          state.error && (
            <ErrorState
              title={t('MobileConnectionError')}
              action={
                state.link && (
                  <RetryButton label={t('Retry')} onClick={() => void resumeDesktop(true)} />
                )
              }
            />
          )
        )}
        {state.backgroundError && <ErrorState title={t('MobileBackgroundError')} />}
        <MobileStudy.Row>
          {state.invite || hasPairing ? (
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => void disconnectDesktop()}
            >
              {t(hasPairing ? 'MobileRevoke' : 'Cancel')}
            </Button>
          ) : (
            <Button disabled={state.busy} onClick={() => void startInvitation()}>
              {t('MobilePair')}
            </Button>
          )}
        </MobileStudy.Row>
      </MobileStudy.Stack>
    </Settings.Section>
  );
}

function PairingIntroduction({ state }: { state: ReturnType<typeof desktopState> }) {
  const { t } = useI18n();

  if (state.revocationPending) return null;

  if (state.link) {
    return (
      <>
        <p>{t(state.connected ? 'MobileConnected' : 'MobileWaiting')}</p>
        <p>{t('MobileAvailabilityDescription')}</p>
      </>
    );
  }

  if (state.invite) return <p>{t('MobileScanDescription')}</p>;

  return (
    <>
      <p>{t('MobileDesktopIntro')}</p>
      <MobileStudy.PairingGuide
        steps={pairingSteps.map(([title, description]) => ({
          title: t(title),
          description: t(description)
        }))}
      />
    </>
  );
}

function InvitationDetails({
  invite,
  approval
}: {
  invite: string;
  approval: ReturnType<typeof desktopState>['approval'];
}) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string>();
  const [clipboard, setClipboard] = useState(false);

  useEffect(() => {
    const url = invite;
    let active = true;

    void import('qrcode')
      .then(async ({ default: qr }) => {
        const image = await qr.toDataURL(url, { width: 256, margin: 3 });

        if (active) setQr(image);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [invite]);

  return (
    <>
      {qr && <img src={qr} width="256" height="256" alt={t('MobileQr')} />}
      <div>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(invite).then(
              () => setClipboard(true),
              () => setClipboard(false)
            );
          }}
        >
          {t(clipboard ? 'MobileCopied' : 'MobileCopy')}
        </Button>
      </div>
      {approval && (
        <MobileStudy.Section>
          <p>{t('MobileConfirmDesktop')}</p>
          <MobileStudy.Code>{approval.code}</MobileStudy.Code>
          <div>
            <Button onClick={approval.confirm}>{t('MobileApprove')}</Button>
          </div>
        </MobileStudy.Section>
      )}
    </>
  );
}
