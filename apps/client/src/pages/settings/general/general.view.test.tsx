import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { GeneralSettingsView } from './general.view';

function model({ vi }: Pick<test.Context, 'vi'>) {
  return {
    data: { language: 1 as const, appearance: 3 as const, zoomPercent: 125, onboarded: true },
    loading: false,
    pending: false,
    error: false,
    retry: vi.fn(),
    setLanguage: vi.fn()
  };
}

test.stable(
  'labels the language selector and disables it while saving',
  ({ render, expect, screen, vi }) => {
    render(<GeneralSettingsView model={{ ...model({ vi }), pending: true }} />);
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving');
  }
);

test.stable(
  'localizes the preferences and offers retry after a failed load',
  ({ render, expect, screen, vi }) => {
    const state = { ...model({ vi }), data: undefined, error: true };

    render(
      <LanguageProvider locale="italian">
        <GeneralSettingsView model={state} />
      </LanguageProvider>
    );
    expect(screen.getByRole('heading', { name: 'Generali' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Impossibile');
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
  }
);
