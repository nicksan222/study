import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { GeneralSettingsView } from './general.view';

function model() {
  return {
    data: { language: 1 as const, appearance: 3 as const, zoomPercent: 125, onboarded: true },
    loading: false,
    pending: false,
    error: false,
    retry: test.vi.fn(),
    setLanguage: test.vi.fn()
  };
}

test.stable('labels the language selector and disables it while saving', () => {
  test.render(<GeneralSettingsView model={{ ...model(), pending: true }} />);
  test.expect(test.screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
  test.expect(test.screen.getByRole('status')).toHaveTextContent('Saving');
});

test.stable('localizes the preferences and offers retry after a failed load', () => {
  const state = { ...model(), data: undefined, error: true };

  test.render(
    <LanguageProvider locale="italian">
      <GeneralSettingsView model={state} />
    </LanguageProvider>
  );
  test.expect(test.screen.getByRole('heading', { name: 'Generali' })).toBeInTheDocument();
  test.expect(test.screen.getByRole('alert')).toHaveTextContent('Impossibile');
  test.expect(test.screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
});
