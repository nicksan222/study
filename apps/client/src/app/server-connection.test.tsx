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

test.stable.each(['english', 'italian'] as const)(
  'live outage recovery in %s preserves drafts and portals without replaying writes',
  async (locale) => {
    const health = test.vi.fn().mockResolvedValue(healthy);
    const save = test.vi.fn().mockRejectedValue(new Error('Offline'));
    const fixture = test.rpcTestTransport(async () => health());
    const reconnect = test.vi.fn();

    test.render(
      <LanguageProvider locale={locale}>
        <fixture.wrapper>
          <ServerConnection onReconnect={reconnect}>
            <Draft save={save} />
          </ServerConnection>
        </fixture.wrapper>
      </LanguageProvider>
    );
    await test.waitFor(() => test.expect(health).toHaveBeenCalledOnce());
    const input = test.screen.getByRole('textbox', { name: 'Draft' });

    test.fireEvent.change(input, { target: { value: 'My unsent question' } });
    const portal = test.screen.getByRole('dialog');

    test.fireEvent.click(test.screen.getByRole('button', { name: 'Save draft' }));
    await test.waitFor(() => test.expect(save).toHaveBeenCalledOnce());
    health.mockRejectedValue(new Error('Offline'));
    await test.act(async () => {
      await fixture.notify();
    });
    test
      .expect(
        await test.screen.findByRole('heading', { name: catalogs[locale].ServerConnectionTitle })
      )
      .toBeVisible();
    test.expect(input).not.toBeVisible();
    test.expect(portal).not.toBeVisible();
    health.mockResolvedValue(healthy);
    await test.act(async () => {
      await fixture.notify();
    });
    await test.waitFor(() => test.expect(input).toBeVisible());
    test.expect(input).toHaveValue('My unsent question');
    test.expect(portal).toBeVisible();
    test.expect(reconnect).toHaveBeenCalledOnce();
    test.expect(save).toHaveBeenCalledOnce();
  }
);
