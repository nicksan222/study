import {
  fromStorage,
  invitationSchema,
  invitationUrl,
  loadPhoneConnection,
  parseInvitation,
  scheduleRequest,
  useI18n
} from '@study/client/companion';
import type { Invitation, OpenPhoneRpc } from '@study/client/companion';
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

import { UnlinkPhone } from './session';

const linkKey = 'study.mobile.phone.v1';

const inviteKey = 'study.mobile.invite.v1';

export function rememberInvitation(url: string) {
  const invitation = parseInvitation(url);

  localStorage.setItem(inviteKey, JSON.stringify(invitation));

  return invitation;
}

function initialLink() {
  const paired = fromStorage(linkKey, invitationSchema);

  if (paired) return { invitation: paired, paired: true };

  return { invitation: fromStorage(inviteKey, invitationSchema), paired: false };
}

export function Phone({ renderApp }: { renderApp: (open: OpenPhoneRpc) => ReactNode }) {
  const { t } = useI18n();
  const [{ invitation, paired }, setLink] = useState(initialLink);
  const [error, setError] = useState<'MobileConnectionError' | 'MobileInviteExpired'>();
  const [browserApproved, setBrowserApproved] = useState(false);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installFirst = !!invitation && ios && !standalone && !paired && !browserApproved;

  useEffect(() => {
    if (paired || invitation?.expiresAt === undefined) return;

    return scheduleRequest(
      async () => {
        localStorage.removeItem(inviteKey);
        setLink({ invitation: undefined, paired: false });
        setError('MobileInviteExpired');
      },
      Math.max(0, invitation.expiresAt - Date.now())
    );
  }, [invitation, paired]);

  function pair(url: string) {
    try {
      setLink({ invitation: rememberInvitation(url), paired: false });
      setError(undefined);
    } catch {
      setError('MobileConnectionError');
    }
  }

  function reset() {
    localStorage.removeItem(linkKey);
    localStorage.removeItem(inviteKey);
    setLink({ invitation: undefined, paired: false });
    setError(undefined);
    setBrowserApproved(false);
  }

  function approve() {
    if (!invitation) return;

    localStorage.setItem(linkKey, JSON.stringify(invitation));
    localStorage.removeItem(inviteKey);
    setLink({ invitation, paired: true });
  }

  if (invitation && !installFirst) {
    return (
      <PhoneSession
        key={invitation.room}
        invitation={invitation}
        paired={paired}
        showInstallHint={!standalone}
        approve={approve}
        reset={reset}
        renderApp={renderApp}
      />
    );
  }

  return (
    <MobileStudy.Screen>
      <MobileStudy.Header title={t('MobileStudy')} />
      {!standalone && <p>{t('MobileInstallHint')}</p>}
      {error && <ErrorState title={t(error)} />}
      {invitation ? (
        <PhoneInstall
          invitation={invitation}
          onContinue={() => setBrowserApproved(true)}
          onError={() => setError('MobileConnectionError')}
        />
      ) : (
        <InviteForm onSubmit={pair} />
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
        onClick={() => {
          void navigator.clipboard
            .writeText(invitationUrl(document.baseURI, invitation))
            .then(() => setCopied(true), onError);
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
  approve,
  reset,
  renderApp
}: {
  invitation: Invitation;
  paired: boolean;
  showInstallHint: boolean;
  approve: () => void;
  reset: () => void;
  renderApp: (open: OpenPhoneRpc) => ReactNode;
}) {
  const [app, setApp] = useState<ReactNode>();
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState<string>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const current = useRef({ paired, approve, renderApp });
  const teardown = useRef<Promise<void>>(undefined);

  useEffect(() => {
    current.current = { paired, approve, renderApp };
  }, [paired, approve, renderApp]);

  useEffect(() => {
    let stopped = false;
    let opened = false;
    let stop: (() => Promise<void>) | undefined;

    void loadPhoneConnection()
      .then(async ({ connectPhone }) => {
        await teardown.current;

        if (stopped) return;

        stop = connectPhone(invitation, current.current.paired, {
          challenge: setCode,
          paired: () => current.current.approve(),
          connected: (open) => {
            if (!opened) {
              setApp(current.current.renderApp(open));
              opened = true;
            }

            setError(false);
            setConnected(true);
          },
          disconnected: () => setConnected(false),
          error: () => setError(true)
        });
      })
      .catch(() => {
        if (!stopped) setError(true);
      });

    return () => {
      stopped = true;
      teardown.current = stop?.().catch(() => undefined);
    };
  }, [invitation, retry]);

  return (
    <>
      {app && (
        <Activity mode={connected ? 'visible' : 'hidden'}>
          <UnlinkPhone.Provider value={reset}>{app}</UnlinkPhone.Provider>
        </Activity>
      )}
      {!connected && (
        <PhoneConnectionPanel
          paired={paired}
          code={code}
          error={error}
          showInstallHint={showInstallHint}
          reset={reset}
          retry={() => {
            setError(false);
            setRetry((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

function PhoneConnectionPanel({
  paired,
  code,
  error,
  showInstallHint,
  reset,
  retry
}: {
  paired: boolean;
  code?: string;
  error: boolean;
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
