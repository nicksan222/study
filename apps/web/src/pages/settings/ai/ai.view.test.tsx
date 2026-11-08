import { createLocalization } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { AiAccountSettingsView, AiModelSettingsView } from './ai.view';
import type { AiSettingsModel } from './use-ai-settings';

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => createLocalization('italian')
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
    setSetup: vi.fn(),
    saveApiKey: vi.fn()
  };
}

testStable('keeps account actions separate from localized model controls without requests', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const model = settingsModel();

  const { rerender, container } = render(<AiAccountSettingsView model={model} />);

  expect(screen.getByText('learner@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Esci' })).toBeEnabled();
  expect(screen.getByRole('combobox')).toBeInTheDocument();
  rerender(<AiModelSettingsView model={model} />);
  expect(screen.queryByText('learner@example.com')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(3);
  expect(container.querySelectorAll('.settings-group')).toHaveLength(1);
  expect(container.querySelector('.settings-group')?.children).toHaveLength(3);
  expect(fetch).not.toHaveBeenCalled();
});

function withAnthropic() {
  const model = settingsModel();

  model.data = {
    status: { signedIn: true, email: null, sharing: false },
    settings: { tiny: { provider: 'anthropic' }, medium: { provider: 1 }, smart: { provider: 1 } },
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        configured: true,
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Attività rapide' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'ChatGPT — Usa predefinito',
      'ChatGPT — GPT-6 Luna',
      'ChatGPT — GPT-6.1 Sol',
      'ChatGPT — GPT-6 Astra',
      'Anthropic — Usa predefinito',
      'Anthropic — claude-haiku-5-5',
      'Anthropic — claude-sonnet-5-5',
      'Anthropic — claude-opus-5-5'
    ]);
    await userEvent.click(
      await screen.findByRole('option', { name: 'Anthropic — claude-opus-5-5' })
    );
    expect(model.setSetup).toHaveBeenCalledWith('tiny', {
      provider: 'anthropic',
      model: 'claude-opus-5-5'
    });
  }
);

testStable('a single choice changes provider and model together', async () => {
  const model = withAnthropic();

  render(<AiModelSettingsView model={model} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Attività complesse' }));
  await userEvent.click(
    await screen.findByRole('option', { name: 'Anthropic — claude-sonnet-5-5' })
  );
  expect(model.setSetup).toHaveBeenCalledExactlyOnceWith('smart', {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5'
  });
});

testStable('saved custom models retain their selected provider and label', async () => {
  const model = withAnthropic();

  model.data = {
    ...model.data!,
    settings: {
      ...model.data!.settings,
      tiny: { provider: 'anthropic', model: 'custom-model' }
    }
  };
  render(<AiModelSettingsView model={model} />);
  expect(screen.getByRole('combobox', { name: 'Attività rapide' })).toHaveTextContent(
    'Anthropic — custom-model'
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Attività rapide' }));
  await userEvent.click(await screen.findByRole('option', { name: 'ChatGPT — Usa predefinito' }));
  expect(model.setSetup).toHaveBeenCalledExactlyOnceWith('tiny', { provider: 1 });
});

testStable(
  'signed-out ChatGPT is absent unless it is the saved choice, which stays disabled',
  async () => {
    const model = withAnthropic();

    model.data = { ...model.data!, status: { signedIn: false, email: null, sharing: false } };
    render(<AiModelSettingsView model={model} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Attività rapide' }));
    expect(
      await screen.findByRole('option', { name: 'Anthropic — Usa predefinito' })
    ).toBeEnabled();
    expect(screen.queryByRole('option', { name: /ChatGPT/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('combobox', { name: 'Attività quotidiane' }));
    expect(
      await screen.findByRole('option', { name: 'ChatGPT — Usa predefinito' })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('option', { name: 'ChatGPT — GPT-6 Luna' })).not.toBeInTheDocument();
    expect(model.setSetup).not.toHaveBeenCalled();
  }
);

testStable('an API provider without a key retains only its disabled saved model', async () => {
  const model = withAnthropic();
  const provider = model.data!.providers[0]!;

  model.data = {
    ...model.data!,
    providers: [{ ...provider, configured: false }],
    settings: { ...model.data!.settings, tiny: { provider: 'anthropic', model: 'claude-opus-5-5' } }
  };
  render(<AiModelSettingsView model={model} />);
  expect(screen.getByRole('combobox', { name: 'Attività rapide' })).toHaveTextContent(
    'Anthropic — claude-opus-5-5'
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Attività rapide' }));
  const saved = await screen.findByRole('option', { name: 'Anthropic — claude-opus-5-5' });

  expect(saved).toHaveAttribute('aria-disabled', 'true');
  expect(
    screen.queryByRole('option', { name: 'Anthropic — Usa predefinito' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Anthropic — claude-sonnet-5-5' })
  ).not.toBeInTheDocument();
  await userEvent.click(saved);
  expect(model.setSetup).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('option', { name: 'ChatGPT — Usa predefinito' }));
  expect(model.setSetup).toHaveBeenCalledExactlyOnceWith('tiny', { provider: 1 });
});

testStable('without credentials all saved choices remain visible and controls are disabled', () => {
  const model = withAnthropic();

  model.data = {
    ...model.data!,
    status: { signedIn: false, email: null, sharing: false },
    providers: model.data!.providers.map((provider) => ({ ...provider, configured: false }))
  };
  render(<AiModelSettingsView model={model} />);

  for (const picker of screen.getAllByRole('combobox')) expect(picker).toBeDisabled();

  expect(screen.getByRole('combobox', { name: 'Attività rapide' })).toHaveTextContent(
    'Anthropic — Usa predefinito'
  );
  expect(screen.getByRole('combobox', { name: 'Attività quotidiane' })).toHaveTextContent(
    'ChatGPT — Usa predefinito'
  );
  expect(model.setSetup).not.toHaveBeenCalled();
});
