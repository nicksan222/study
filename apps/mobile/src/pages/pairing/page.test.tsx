import { LanguageProvider } from '@study/client/companion';
import { invitationUrl } from '@study/client/pairing';
import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { useContext } from 'react';

import type { connectPhone } from '#mobile/features/pairing/connection.ts';

type ConnectionEvents = Parameters<typeof connectPhone>[2];

const companion = Bun.pathToFileURL(Bun.resolveSync('@study/client/companion', process.cwd()));

const phoneConnection = new URL('../../../mobile/src/features/pairing/connection.ts', companion);

const inviteKey = 'study.mobile.invite.v1';

const linkKey = 'study.mobile.phone.v1';

function invite(expiresAt?: number) {
  return {
    room: crypto.randomUUID(),
    secret: crypto.randomUUID(),
    desktop: 'desktop012345678901234',
    expiresAt
  };
}

test.unit.stable.for(['english', 'italian'] as const)(
  'the phone gates access until approval, waits during disconnect and forgets the link on unlink (%s)',
  async (locale, { mock, expect, screen, render, fireEvent, userEvent, act, onTestFinished }) => {
    const copy = catalogs[locale];
    const active = Promise.withResolvers<ConnectionEvents>();
    const stop = mock.fn(async () => {});
    const renderApp = mock.fn(() => <SharedStudy />);
    const invitation = invitationUrl('https://example.com/study/mobile/', invite());

    mock(phoneConnection, () => ({
      connectPhone: (_invitation: unknown, _paired: boolean, events: ConnectionEvents) => {
        active.resolve(events);

        return stop;
      }
    }));
    const { Phone } = await import('./page');
    const { UnlinkPhone } = await import('#mobile/features/pairing/session.ts');

    function SharedStudy() {
      const unlink = useContext(UnlinkPhone);

      return <button onClick={unlink}>{copy.MobileUnlink}</button>;
    }

    onTestFinished(() => localStorage.clear());
    const view = render(
      <LanguageProvider locale={locale}>
        <Phone renderApp={renderApp} />
      </LanguageProvider>
    );

    fireEvent.change(screen.getByRole('textbox', { name: copy.MobileInvite }), {
      target: { value: invitation }
    });
    await userEvent.click(screen.getByRole('button', { name: copy.MobilePair }));

    const events = await active.promise;
    const open = mock.fn();

    act(() => events.challenge('123456'));
    expect(screen.getByText('123456')).toBeVisible();
    expect(renderApp).not.toHaveBeenCalled();

    act(() => {
      events.paired();
      events.connected(open);
    });
    expect(renderApp).toHaveBeenCalledWith(open);
    const unlink = screen.getByRole('button', { name: copy.MobileUnlink });

    act(() => events.disconnected());
    expect(unlink).not.toBeVisible();
    expect(screen.getByText(copy.MobileWaitingForDesktop)).toBeVisible();

    act(() => events.connected(open));
    expect(unlink).toBeVisible();
    expect(renderApp).toHaveBeenCalledTimes(1);
    await userEvent.click(unlink);
    expect(stop).toHaveBeenCalledTimes(1);
    view.unmount();
    render(
      <LanguageProvider locale={locale}>
        <Phone renderApp={renderApp} />
      </LanguageProvider>
    );
    expect(screen.getByRole('textbox', { name: copy.MobileInvite })).toBeVisible();
  }
);

test.unit.stable(
  'an incoming invitation does not silently replace an existing link',
  async ({ mock, expect, screen, render, onTestFinished }) => {
    const copy = catalogs.english;
    const saved = invite();

    onTestFinished(() => localStorage.clear());
    localStorage.setItem(linkKey, JSON.stringify(saved));
    mock(phoneConnection, () => ({ connectPhone: mock.fn(() => async () => {}) }));
    const { Phone } = await import('./page');
    const { importInvitation } = await import('#mobile/features/pairing/invitations.ts');
    const notice = importInvitation(invitationUrl('https://example.com/study/mobile/', invite()));

    render(
      <LanguageProvider locale="english">
        <Phone initialError={notice} renderApp={() => null} />
      </LanguageProvider>
    );
    expect(screen.getByText(copy.MobileAlreadyPaired)).toBeVisible();
    expect(localStorage.getItem(linkKey)).toBe(JSON.stringify(saved));
    expect(localStorage.getItem(inviteKey)).toBeNull();
  }
);

test.unit.stable(
  'an invitation still expires if storage removal throws',
  async ({ mock, expect, screen, render, act, onTestFinished }) => {
    const copy = catalogs.english;
    const expiry = Promise.withResolvers<() => Promise<void>>();

    onTestFinished(() => localStorage.clear());
    localStorage.setItem(inviteKey, JSON.stringify(invite(Date.now() + 30_000)));
    mock(phoneConnection, () => ({ connectPhone: mock.fn(() => async () => {}) }));
    mock(new URL('../lib/study-client/repeat-request.ts', companion), () => ({
      scheduleRequest: (callback: () => Promise<void>) => {
        expiry.resolve(callback);

        return () => {};
      }
    }));
    const { Phone } = await import('./page');

    render(
      <LanguageProvider locale="english">
        <Phone renderApp={() => null} />
      </LanguageProvider>
    );
    const expire = await expiry.promise;

    mock.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    await act(expire);
    expect(screen.getByText(copy.MobileInviteExpired)).toBeVisible();
    expect(screen.getByRole('textbox', { name: copy.MobileInvite })).toBeVisible();
  }
);

test.unit.stable(
  'an interrupted save is visible while disconnected and is not replayed',
  async ({ mock, expect, screen, render, userEvent, act, rpc, waitFor, onTestFinished }) => {
    const copy = catalogs.italian;
    const active = Promise.withResolvers<ConnectionEvents>();
    const disconnect = Promise.withResolvers<void>();
    const save = mock.fn(async () => {
      await disconnect.promise;

      throw new StudyError('transient', 'Disconnected');
    });

    onTestFinished(() => localStorage.clear());
    localStorage.setItem(linkKey, JSON.stringify(invite()));
    const noteStart = new URL('../features/note-workspace/start.queries.ts', companion);

    mock(noteStart, async () => ({
      ...(await mock.importActual<Record<string, unknown>>(Bun.fileURLToPath(noteStart))),
      startNote: save
    }));
    mock(phoneConnection, () => ({
      connectPhone: (_invitation: unknown, _paired: boolean, events: ConnectionEvents) => {
        active.resolve(events);

        return async () => {};
      }
    }));
    const { Phone } = await import('./page');
    const { MobileCapture } = await import('#mobile/features/quick-capture/capture.tsx');

    render(
      <LanguageProvider locale="italian">
        <Phone renderApp={() => <MobileCapture transport={rpc.transport} />} />
      </LanguageProvider>
    );
    const events = await active.promise;
    const open = mock.fn();

    act(() => events.connected(open));
    await userEvent.type(screen.getByRole('textbox', { name: copy.MobileCaptureText }), 'Conserva');
    await userEvent.click(screen.getByRole('button', { name: copy.MobileCaptureSave }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => {
      events.disconnected();
      disconnect.resolve();
    });
    await waitFor(() =>
      expect(screen.getAllByRole('status').map((element) => element.textContent)).toContain(
        copy.MobileCaptureUncertain
      )
    );

    act(() => events.connected(open));
    expect(screen.getByRole('textbox', { name: copy.MobileCaptureText })).toHaveValue('Conserva');
    expect(screen.getByRole('button', { name: copy.MobileCaptureAnother })).toBeVisible();
    expect(save).toHaveBeenCalledOnce();
  }
);

test.unit.stable(
  'failed unlink disconnects the phone and allows retrying storage removal',
  async ({ mock, expect, screen, render, userEvent, onTestFinished }) => {
    const copy = catalogs.english;
    const active = Promise.withResolvers<ConnectionEvents>();
    const stop = mock.fn(async () => {});

    onTestFinished(() => localStorage.clear());
    localStorage.setItem(linkKey, JSON.stringify(invite()));
    mock(phoneConnection, () => ({
      connectPhone: (_invitation: unknown, _paired: boolean, events: ConnectionEvents) => {
        active.resolve(events);

        return stop;
      }
    }));
    const { Phone } = await import('./page');

    render(
      <LanguageProvider locale="english">
        <Phone renderApp={() => null} />
      </LanguageProvider>
    );
    await active.promise;
    mock.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    await userEvent.click(screen.getByRole('button', { name: copy.MobileUnlink }));
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByText(copy.MobileUnlinkError)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: copy.MobileInvite })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: copy.Retry }));
    expect(localStorage.getItem(linkKey)).toBeNull();
    expect(screen.getByRole('textbox', { name: copy.MobileInvite })).toBeVisible();
  }
);
