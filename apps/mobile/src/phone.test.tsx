import { LanguageProvider, invitationUrl } from '@study/client/companion';
import type { loadPhoneConnection } from '@study/client/companion';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { useContext } from 'react';

type ConnectionEvents = Parameters<
  Awaited<ReturnType<typeof loadPhoneConnection>>['connectPhone']
>[2];

test.unit.stable.for(['english', 'italian'] as const)(
  'the phone gates access until approval, waits during disconnect and forgets the link on unlink (%s)',
  async (locale, { mock, expect, screen, render, fireEvent, userEvent, act, onTestFinished }) => {
    const copy = catalogs[locale];
    const active = Promise.withResolvers<ConnectionEvents>();
    const stop = mock.fn(async () => {});
    const renderApp = mock.fn(() => <SharedStudy />);
    const invitation = invitationUrl('https://example.com/study/mobile/', {
      room: crypto.randomUUID(),
      secret: crypto.randomUUID(),
      desktop: 'desktop012345678901234'
    });

    mock('#client/lib/mobile-link/phone-connection.ts', () => ({
      connectPhone: (_invitation: unknown, _paired: boolean, events: ConnectionEvents) => {
        active.resolve(events);

        return stop;
      }
    }));
    const { Phone } = await import('./phone');
    const { UnlinkPhone } = await import('./session');

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
