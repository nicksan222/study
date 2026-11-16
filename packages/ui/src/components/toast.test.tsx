import { test } from '@study/testing';

import { ToastProvider, toastManager } from './toast';

test.stable(
  'shows standard success feedback and supports keyboard access and localized dismissal',
  async ({ userEvent, render, screen, expect, waitFor }) => {
    const user = userEvent.setup();

    render(
      <ToastProvider closeLabel="Dismiss notification" viewportLabel="Notifications">
        <button
          type="button"
          onClick={() => toastManager.add({ title: 'Backup created', type: 'success' })}
        >
          Notify
        </button>
      </ToastProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(await screen.findByText('Backup created')).toBeVisible();
    await user.keyboard('{F6}');
    await waitFor(() => expect(document.querySelector('.ui-toast-viewport')).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    await waitFor(() => expect(screen.queryByText('Backup created')).toBeNull());
  }
);

test.stable(
  'localizes the notification region instead of exposing the primitive English default',
  ({ render, expect }) => {
    render(
      <ToastProvider closeLabel="Chiudi" viewportLabel="Notifiche">
        <span>App</span>
      </ToastProvider>
    );
    expect(document.querySelector('.ui-toast-viewport')).toHaveAccessibleName('Notifiche');
  }
);
