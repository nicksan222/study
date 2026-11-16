import { test } from '@study/testing';

import { ToastProvider, toastManager } from './toast';

test.stable(
  'shows standard success feedback and supports keyboard access and localized dismissal',
  async () => {
    const user = test.userEvent.setup();

    test.render(
      <ToastProvider closeLabel="Dismiss notification" viewportLabel="Notifications">
        <button
          type="button"
          onClick={() => toastManager.add({ title: 'Backup created', type: 'success' })}
        >
          Notify
        </button>
      </ToastProvider>
    );
    await user.click(test.screen.getByRole('button', { name: 'Notify' }));
    test.expect(await test.screen.findByText('Backup created')).toBeVisible();
    await user.keyboard('{F6}');
    await test.waitFor(() =>
      test.expect(document.querySelector('.ui-toast-viewport')).toHaveFocus()
    );
    await user.click(test.screen.getByRole('button', { name: 'Dismiss notification' }));
    await test.waitFor(() => test.expect(test.screen.queryByText('Backup created')).toBeNull());
  }
);

test.stable(
  'localizes the notification region instead of exposing the primitive English default',
  () => {
    test.render(
      <ToastProvider closeLabel="Chiudi" viewportLabel="Notifiche">
        <span>App</span>
      </ToastProvider>
    );
    test.expect(document.querySelector('.ui-toast-viewport')).toHaveAccessibleName('Notifiche');
  }
);
