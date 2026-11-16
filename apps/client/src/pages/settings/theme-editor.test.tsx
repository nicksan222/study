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
  async () => {
    const remove = test.vi.fn().mockResolvedValue(undefined);
    const close = test.vi.fn();
    const model: AppearanceModel = {
      loading: false,
      error: false,
      pending: false,
      retry: test.vi.fn(),
      setPreferences: test.vi.fn(),
      setZoom: test.vi.fn(),
      setAppearance: test.vi.fn(),
      selectTheme: test.vi.fn(),
      importTheme: test.vi.fn(),
      saveTheme: test.vi.fn(),
      deleteTheme: remove
    };

    test.render(
      <ThemeEditor.Delete
        theme={{ version: 1, id: 'ocean', name: 'Ocean' }}
        model={model}
        onClose={close}
      />
    );
    const dialog = await test.screen.findByRole('alertdialog');
    const confirm = test.within(dialog).getByRole('button', { name: catalogs.english.DeleteTheme });
    const field = test.within(dialog).getByRole('textbox');
    const user = test.userEvent.setup();

    test.expect(confirm).toBeDisabled();
    await user.type(field, 'wrong');
    test.expect(confirm).toBeDisabled();
    test.expect(remove).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, catalogs.english.DeleteConfirmationWord);
    await user.click(confirm);
    await test.waitFor(() => test.expect(remove).toHaveBeenCalledExactlyOnceWith('ocean'));
    test.expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
      title: catalogs.english.ThemeDeleted,
      type: 'success'
    });
    test.expect(close).toHaveBeenCalledOnce();
  }
);
