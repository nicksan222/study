import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { AiAccountSettingsView, AiModelSettingsView } from './ai.view';
import type { AiSettingsModel } from './use-ai-settings';

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: keyof typeof catalogs.italian) => catalogs.italian[key] })
}));

function settingsModel(): AiSettingsModel {
  return {
    data: {
      status: { signedIn: true, email: 'learner@example.com', sharing: false },
      providers: [],
      settings: { tiny: { provider: 1 }, medium: { provider: 1 }, smart: { provider: 1 } }
    },
    loading: false,
    signInUnsupported: false,
    error: false,
    pending: false,
    cancelling: false,
    attempt: undefined,
    popupBlocked: false,
    retry: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    signOut: vi.fn(),
    credentialProvider: '1',
    selectCredentialProvider: vi.fn(),
    setModel: vi.fn(),
    setProvider: vi.fn(),
    saveApiKey: vi.fn()
  };
}

testStable('keeps account actions separate from localized model controls without requests', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const model = settingsModel();

  const { rerender } = render(<AiAccountSettingsView model={model} />);

  expect(screen.getByText('learner@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Esci' })).toBeEnabled();
  expect(screen.getByRole('combobox')).toBeInTheDocument();
  rerender(<AiModelSettingsView model={model} />);
  expect(screen.queryByText('learner@example.com')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(6);
  expect(fetch).not.toHaveBeenCalled();
});

function withAnthropic() {
  const model = settingsModel();

  model.data = {
    status: { signedIn: false, email: null, sharing: false },
    settings: { tiny: { provider: 'anthropic' }, medium: { provider: 1 }, smart: { provider: 1 } },
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        configured: false,
        models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
        defaults: {
          tiny: 'claude-haiku-5-5',
          medium: 'claude-sonnet-5-5',
          smart: 'claude-opus-5-5'
        }
      }
    ]
  };

  return model;
}

testStable('credential selection renders exactly one provider dropdown and password input', () => {
  const model = withAnthropic();

  model.credentialProvider = 'anthropic';
  render(<AiAccountSettingsView model={model} />);
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(screen.getByLabelText('Chiave API')).toHaveAttribute('type', 'password');
});

testStable(
  'model dropdowns offer registered provider models and commit the selected ID',
  async () => {
    const model = withAnthropic();

    render(<AiModelSettingsView model={model} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('combobox', { name: 'Modello' })[0]!);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'Usa predefinito',
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5'
    ]);
    await userEvent.click(screen.getByRole('option', { name: 'claude-opus-5-5' }));
    expect(model.setModel).toHaveBeenCalledWith('tiny', 'claude-opus-5-5');
  }
);
