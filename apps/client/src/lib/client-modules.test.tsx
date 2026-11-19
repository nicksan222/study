import { test } from '@study/testing';
import { useState } from 'react';
import type { PropsWithChildren } from 'react';

import { ClientExtensions, ClientPageActions } from './client-modules';
import type { ClientModule } from './client-modules';

function Gate({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);

  return ready ? children : <button onClick={() => setReady(true)}>Unlock</button>;
}

const module: ClientModule = {
  id: 'platform-test',
  Boundary: Gate,
  Background: () => <span>Background ready</span>,
  PageActions: ({ busy }) => <button disabled={busy}>Platform action</button>
};

test.unit.stable(
  'registered modules wrap pages, run background behavior and fill the page action slot',
  async ({ render, screen, userEvent, expect }) => {
    const page = (
      <>
        <h1>Client page</h1>
        <ClientPageActions busy />
      </>
    );
    const view = render(<ClientExtensions>{page}</ClientExtensions>);

    expect(screen.getByRole('heading', { name: 'Client page' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Platform action' })).toBeNull();

    view.rerender(<ClientExtensions modules={[module]}>{page}</ClientExtensions>);
    expect(screen.getByText('Background ready')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Client page' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(screen.getByRole('heading', { name: 'Client page' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Platform action' })).toBeDisabled();
  }
);
