import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { LanguageProvider } from '../../../lib/i18n';
import { GeneralSettingsView } from './general.view';

function model() {
  return {
    data: { language: 1 as const, appearance: 3 as const, zoomPercent: 125, onboarded: true },
    loading: false,
    pending: false,
    error: false,
    retry: vi.fn(),
    setLanguage: vi.fn()
  };
}

it('labels the language selector and disables it while saving', () => {
  render(<GeneralSettingsView model={{ ...model(), pending: true }} />);
  expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving');
});

it('localizes the preferences and offers retry after a failed load', () => {
  const state = { ...model(), data: undefined, error: true };

  render(
    <LanguageProvider locale="italian">
      <GeneralSettingsView model={state} />
    </LanguageProvider>
  );
  expect(screen.getByRole('heading', { name: 'Generali' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Impossibile');
  expect(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
});
