import { useI18n } from '@study/client/companion';
import {
  invitationUrl,
  inviteDuration,
  parseInvitation,
  scheduleRequest
} from '@study/client/pairing';
import type { Invitation, OpenPhoneRpc } from '@study/client/pairing';
import {
  Button,
  ErrorState,
  Field,
  MobileStudy,
  StatusMessage,
  Input,
  RetryButton
} from '@study/ui';
import { Activity, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  initialLink,
  rememberInvitation,
  removeStored,
  inviteKey,
  linkKey
} from '#mobile/features/pairing/invitations.ts';
import type { PairingError } from '#mobile/features/pairing/invitations.ts';
import { UnlinkPhone } from '#mobile/features/pairing/session.ts';
import { CaptureSaveState } from '#mobile/features/quick-capture/state.ts';
import type { SaveStatus } from '#mobile/features/quick-capture/state.ts';

export function Phone({
  initialError,
  renderApp
}: {
  initialError?: PairingError;
  renderApp: (open: OpenPhoneRpc) => ReactNode;
}) {
  const { t } = useI18n();
  const [{ invitation, paired }, setLink] = useState(initialLink);
  const [error, setError] = useState(initialError);
  const [browserApproved, setBrowserApproved] = useState(false);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installFirst = !!invitation && ios && !standalone && !paired && !browserApproved;

  useEffect(() => {
    if (!paired) return;

    function syncUnlink(event: StorageEvent) {
      if (event.storageArea !== localStorage) return;

      const linkRemoved = event.key === linkKey && event.newValue === null;

      if (linkRemoved || event.key === null) {
        setLink({ invitation: undefined, paired: false });
        setBrowserApproved(false);
        setError(undefined);
      }
    }

    window.addEventListener('storage', syncUnlink);

    return () => window.removeEventListener('storage', syncUnlink);
  }, [paired]);

  function expire() {
    removeStored(inviteKey);
    setLink({ invitation: undefined, paired: false });
    setError('MobileInviteWaitEnded');
  }

  function pair(url: string) {
    try {
      setLink({ invitation: rememberInvitation(parseInvitation(url)), paired: false });
      setError(undefined);
    } catch {
      setError('MobileConnectionError');
    }
  }

  function reset() {
    setLink({ invitation: undefined, paired: false });
    setBrowserApproved(false);
    const linkRemoved = removeStored(linkKey);
    const inviteRemoved = removeStored(inviteKey);

    setError(linkRemoved && inviteRemoved ? undefined : 'MobileUnlinkError');
  }

  function approve() {
    if (!invitation) return;

    localStorage.setItem(linkKey, JSON.stringify(invitation));
    removeStored(inviteKey);
    setLink({ invitation, paired: true });
  }

  if (invitation && !installFirst) {
    return (
      <PhoneSession
        key={invitation.room}
        invitation={invitation}
        paired={paired}
        showInstallHint={!standalone}
        notice={error && <ErrorState title={t(error)} />}
        approve={approve}
        expire={expire}
        reset={reset}
        renderApp={renderApp}
      />
    );
  }

  return (
    <PhoneEntry error={error} standalone={standalone} retryUnlink={reset}>
      {invitation ? (
        <PhoneInstall
          invitation={invitation}
          onContinue={() => setBrowserApproved(true)}
          onError={() => setError('MobileConnectionError')}
        />
      ) : (
        <InviteForm onSubmit={pair} />
      )}
    </PhoneEntry>
  );
}

function PhoneEntry({
  error,
  standalone,
  retryUnlink,
  children
}: {
  error?: PairingError;
  standalone: boolean;
  retryUnlink: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <MobileStudy.Screen>
      <MobileStudy.Header title={t('MobileStudy')} />
      {error === 'MobileUnlinkError' ? (
        <ErrorState
          title={t(error)}
          action={<RetryButton label={t('Retry')} onClick={retryUnlink} />}
        />
      ) : (
        <>
          {!standalone && <p>{t('MobileInstallHint')}</p>}
          {error && <ErrorState title={t(error)} />}
          {children}
        </>
      )}
    </MobileStudy.Screen>
  );
}

function PhoneInstall({
  invitation,
  onContinue,
  onError
}: {
  invitation: Invitation;
  onContinue: () => void;
  onError: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  return (
    <MobileStudy.Row>
      <Button
        onClick={async () => {
          const { clipboard } = navigator;

          if (!clipboard) {
            onError();

            return;
          }

          try {
            await clipboard.writeText(invitationUrl(document.baseURI, invitation));
            setCopied(true);
          } catch {
            onError();
          }
        }}
      >
        {t(copied ? 'MobileCopied' : 'MobileCopy')}
      </Button>
      <Button variant="outline" onClick={onContinue}>
        {t('MobileUseBrowser')}
      </Button>
    </MobileStudy.Row>
  );
}

function InviteForm({ onSubmit }: { onSubmit: (value: string) => void }) {
  const { t } = useI18n();
  const [input, setInput] = useState('');

  return (
    <MobileStudy.Form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(input);
      }}
    >
      <p>{t('MobilePhoneIntro')}</p>
      <Field label={t('MobileInvite')}>
        <Input
          type="url"
          required
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </Field>
      <div>
        <Button type="submit">{t('MobilePair')}</Button>
      </div>
    </MobileStudy.Form>
  );
}

function PhoneSession({
  invitation,
  paired,
  showInstallHint,
  notice,
  approve,
  expire,
  reset,
  renderApp
}: {
  invitation: Invitation;
  paired: boolean;
  showInstallHint: boolean;
  notice?: ReactNode;
  approve: () => void;
  expire: () => void;
  reset: () => void;
  renderApp: (open: OpenPhoneRpc) => ReactNode;
}) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const { app, connected, code, error, retry } = usePhoneConnection(invitation, {
    paired,
    approve,
    expire,
    renderApp
  });

  return (
    <>
      {notice}
      <Activity mode={connected ? 'visible' : 'hidden'}>
        <CaptureSaveState.Provider value={{ status, setStatus }}>
          <UnlinkPhone.Provider value={reset}>{app}</UnlinkPhone.Provider>
        </CaptureSaveState.Provider>
      </Activity>
      {!connected && (
        <PhoneConnectionPanel
          paired={paired}
          code={code}
          error={error}
          uncertain={status === 'uncertain'}
          showInstallHint={showInstallHint}
          reset={reset}
          retry={retry}
        />
      )}
    </>
  );
}

function usePhoneConnection(
  invitation: Invitation,
  actions: {
    paired: boolean;
    approve: () => void;
    expire: () => void;
    renderApp: (open: OpenPhoneRpc) => ReactNode;
  }
) {
  const [app, setApp] = useState<ReactNode>();
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState<string>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const current = useRef(actions);
  const teardown = useRef<Promise<void>>(undefined);

  useEffect(() => {
    current.current = actions;
  }, [actions]);

  useEffect(() => {
    let stopped = false;
    let opened = false;
    let stop: (() => Promise<void>) | undefined;
    const cancelWait = current.current.paired
      ? undefined
      : scheduleRequest(async () => current.current.expire(), inviteDuration);

    function showApp(open: OpenPhoneRpc) {
      if (opened) return;

      setApp(current.current.renderApp(open));
      opened = true;
    }

    void import('#mobile/features/pairing/connection.ts')
      .then(async ({ connectPhone }) => {
        await teardown.current;

        if (stopped) return;

        stop = connectPhone(invitation, current.current.paired, {
          challenge: (value) => {
            // The approval request has its own timeout after the comparison code appears.
            cancelWait?.();
            setCode(value);
            setError(false);
          },
          paired: () => current.current.approve(),
          connected: (open) => {
            showApp(open);
            setError(false);
            setConnected(true);
          },
          disconnected: () => {
            setCode(undefined);
            setConnected(false);

            if (!current.current.paired) setError(true);
          },
          error: () => {
            setCode(undefined);
            setError(true);
          }
        });
      })
      .catch(() => {
        if (!stopped) setError(true);
      });

    return () => {
      stopped = true;
      cancelWait?.();
      teardown.current = stop?.().catch(() => undefined);
    };
  }, [invitation, retry]);

  function retryConnection() {
    setCode(undefined);
    setError(false);
    setRetry((value) => value + 1);
  }

  return { app, connected, code, error, retry: retryConnection };
}

function PhoneConnectionPanel({
  paired,
  code,
  error,
  uncertain,
  showInstallHint,
  reset,
  retry
}: {
  paired: boolean;
  code?: string;
  error: boolean;
  uncertain: boolean;
  showInstallHint: boolean;
  reset: () => void;
  retry: () => void;
}) {
  const { t } = useI18n();

  return (
    <MobileStudy.Screen>
      <MobileStudy.Header title={t('MobileStudy')}>
        <StatusMessage>{t(paired ? 'MobileWaitingForDesktop' : 'MobilePairing')}</StatusMessage>
      </MobileStudy.Header>
      {showInstallHint && <p>{t('MobileInstallHint')}</p>}
      {uncertain && <StatusMessage>{t('MobileCaptureUncertain')}</StatusMessage>}
      {code && !paired && (
        <div>
          <p>{t('MobileConfirmPhone')}</p>
          <MobileStudy.Code>{code}</MobileStudy.Code>
        </div>
      )}
      {error && (
        <ErrorState
          title={t('MobileConnectionError')}
          action={<RetryButton label={t('Retry')} onClick={retry} />}
        />
      )}
      <div>
        <Button variant="outline" onClick={reset}>
          {t(paired ? 'MobileUnlink' : 'Cancel')}
        </Button>
      </div>
    </MobileStudy.Screen>
  );
}
