import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { useNativeAction } from '#client/lib/effect/native.ts';
import { LanguageProvider } from '#client/lib/i18n.tsx';

import { ServerConnection } from './server-connection';

const healthy = { protocolVersion: 1, workersRunning: true, testMode: false };

function Draft({ save }: { save: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const action = useNativeAction(save);

  return (
    <>
      <label>
        Draft
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button onClick={() => action.mutate(undefined)}>Save draft</button>
      <p>open tab</p>
      {createPortal(<div role="dialog">Existing dialog</div>, document.body)}
    </>
  );
}

test.stable.for(['english', 'italian'] as const)(
  'live outage recovery in %s preserves drafts and portals without replaying writes',
  async (locale, { vi, rpcTestTransport, render, waitFor, expect, screen, fireEvent, act }) => {
    const health = vi.fn().mockResolvedValue(healthy);
    const save = vi.fn().mockRejectedValue(new Error('Offline'));
    const fixture = rpcTestTransport(async () => health());
    const reconnect = vi.fn();

    render(
      <LanguageProvider locale={locale}>
        <fixture.wrapper>
          <ServerConnection onReconnect={reconnect}>
            <Draft save={save} />
          </ServerConnection>
        </fixture.wrapper>
      </LanguageProvider>
    );
    await waitFor(() => expect(health).toHaveBeenCalledOnce());
    const input = screen.getByRole('textbox', { name: 'Draft' });

    fireEvent.change(input, { target: { value: 'My unsent question' } });
    const portal = screen.getByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    health.mockRejectedValue(new Error('Offline'));
    await act(async () => {
      await fixture.notify();
    });
    expect(
      await screen.findByRole('heading', { name: catalogs[locale].ServerConnectionTitle })
    ).toBeVisible();
    expect(input).not.toBeVisible();
    expect(portal).not.toBeVisible();
    health.mockResolvedValue(healthy);
    await act(async () => {
      await fixture.notify();
    });
    await waitFor(() => expect(input).toBeVisible());
    expect(input).toHaveValue('My unsent question');
    expect(portal).toBeVisible();
    expect(reconnect).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  }
);
