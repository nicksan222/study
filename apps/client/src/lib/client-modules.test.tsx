import { test } from '@study/testing';
import { createContext, useContext, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { ClientExtensions, ClientSlot } from './client-modules';
import type { ClientModule } from './client-modules';

function Gate({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);

  return ready ? children : <button onClick={() => setReady(true)}>Unlock</button>;
}

const module: ClientModule = {
  id: 'platform-test',
  Boundary: Gate,
  Background: () => <span>Background ready</span>,
  slots: {
    'capture.actions': ({ busy }) => <button disabled={busy}>Platform action</button>
  }
};

test.unit.stable(
  'registered modules wrap pages, run background behavior and fill the page action slot',
  async ({ render, screen, userEvent, within, expect }) => {
    const page = (
      <>
        <h1>Client page</h1>
        <div aria-label="Shell actions" role="group">
          <ClientSlot name="shell.pageActions" props={{}} />
        </div>
        <div aria-label="Capture actions" role="group">
          <ClientSlot name="capture.actions" props={{ busy: true }} />
        </div>
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
    const shell = within(screen.getByRole('group', { name: 'Shell actions' }));
    const capture = within(screen.getByRole('group', { name: 'Capture actions' }));

    expect(shell.queryByRole('button', { name: 'Platform action' })).toBeNull();
    expect(capture.getByRole('button', { name: 'Platform action' })).toBeDisabled();
  }
);

const Count = createContext({ count: 0, increment: () => {} });

function SharedCounter({ children }: PropsWithChildren) {
  const [count, setCount] = useState(0);

  return (
    <Count.Provider value={{ count, increment: () => setCount((value) => value + 1) }}>
      {children}
    </Count.Provider>
  );
}

function CounterAction({ label }: { label: string }) {
  const { count, increment } = useContext(Count);

  return (
    <button onClick={increment}>
      {label}: {count}
    </button>
  );
}

const counterLogic: ClientModule = { id: 'counter', Boundary: SharedCounter };

const platformCases = [
  {
    name: 'Desktop',
    slot: 'shell.pageActions',
    ui: {
      id: 'desktop-counter',
      slots: { 'shell.pageActions': () => <CounterAction label="Desktop" /> }
    }
  },
  {
    name: 'Mobile',
    slot: 'capture.actions',
    ui: {
      id: 'mobile-counter',
      slots: { 'capture.actions': () => <CounterAction label="Mobile" /> }
    }
  }
] as const;

test.unit.stable.for(platformCases)(
  'a shared provider supplies state to the $name contribution',
  async ({ name, slot, ui }, { render, screen, userEvent, expect }) => {
    render(
      <ClientExtensions modules={[counterLogic, ui]}>
        <ClientSlot name={slot} props={{ busy: false }} />
      </ClientExtensions>
    );

    await userEvent.click(screen.getByRole('button', { name: name + ': 0' }));
    expect(screen.getByRole('button', { name: name + ': 1' })).toBeVisible();
  }
);
