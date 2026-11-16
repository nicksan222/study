import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type * as UiModule from '@study/ui';

import type * as __StudyMockType0 from '#client/pages/settings/theme-editor.tsx';

import type { AppearanceModel } from './use-page';

let ThemeEditor: typeof __StudyMockType0.ThemeEditor;

let toastManager: typeof UiModule.toastManager;

test.beforeEach(async ({ mock }) => {
  mock('@study/ui', async (load) => {
    const actual = await load<typeof UiModule>();

    return { ...actual, toastManager: { ...actual.toastManager, add: mock.fn() } };
  });
  toastManager = (await import('@study/ui')).toastManager;
  const __studyMockModule0 = await import('./theme-editor');

  ThemeEditor = __studyMockModule0.ThemeEditor;
});

test.stable(
  'requires the deletion phrase before deleting the selected theme and announcing success',
  async ({ vi, render, screen, within, userEvent, expect, waitFor }) => {
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
  }
);
