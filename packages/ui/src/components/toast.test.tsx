import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vite-plus/test';

import { ToastProvider, toastManager } from './toast';

testStable(
  'shows standard success feedback and supports keyboard access and localized dismissal',
  async () => {
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

testStable(
  'localizes the notification region instead of exposing the primitive English default',
  () => {
    render(
      <ToastProvider closeLabel="Chiudi" viewportLabel="Notifiche">
        <span>App</span>
      </ToastProvider>
    );
    expect(document.querySelector('.ui-toast-viewport')).toHaveAccessibleName('Notifiche');
  }
);
