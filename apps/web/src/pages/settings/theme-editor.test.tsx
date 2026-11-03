import { catalogs } from '@study/localization';
import { toastManager } from '@study/ui/toast';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { ThemeEditor } from './theme-editor';
import type { AppearanceModel } from './use-page';

vi.mock('@study/ui/toast', () => ({ toastManager: { add: vi.fn() } }));

it('requires the deletion phrase before deleting the selected theme and announcing success', async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const model: AppearanceModel = {
    loading: false,
    error: false,
    pending: false,
    retry: vi.fn(),
    setPreferences: vi.fn(),
    setZoom: vi.fn(),
    setAppearance: vi.fn(),
    selectTheme: vi.fn(),
    importTheme: vi.fn(),
    saveTheme: vi.fn(),
    deleteTheme: remove
  };

  render(
    <ThemeEditor.Delete
      theme={{ version: 1, id: 'ocean', name: 'Ocean' }}
      model={model}
      onClose={close}
    />
  );
  const dialog = await screen.findByRole('alertdialog');
  const confirm = within(dialog).getByRole('button', { name: catalogs.english.DeleteTheme });
  const field = within(dialog).getByRole('textbox');
  const user = userEvent.setup();

  expect(confirm).toBeDisabled();
  await user.type(field, 'wrong');
  expect(confirm).toBeDisabled();
  expect(remove).not.toHaveBeenCalled();
  await user.clear(field);
  await user.type(field, catalogs.english.DeleteConfirmationWord);
  await user.click(confirm);
  await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('ocean'));
  expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
    title: catalogs.english.ThemeDeleted,
    type: 'success'
  });
  expect(close).toHaveBeenCalledOnce();
});
