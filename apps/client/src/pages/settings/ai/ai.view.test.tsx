import { createLocalization } from '@study/localization';
import { test } from '@study/testing';

import type * as __StudyMockType0 from '#client/pages/settings/ai/ai.view.tsx';

import type { AiSettingsModel } from './use-ai-settings';

let AiAccountSettingsView: typeof __StudyMockType0.AiAccountSettingsView;

let AiModelSettingsView: typeof __StudyMockType0.AiModelSettingsView;

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => createLocalization('italian')
  }));
  const __studyMockModule0 = await import('./ai.view');

  AiAccountSettingsView = __studyMockModule0.AiAccountSettingsView;
  AiModelSettingsView = __studyMockModule0.AiModelSettingsView;
});

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
    retry: test.vi.fn(),
    start: test.vi.fn(),
    cancel: test.vi.fn(),
    signOut: test.vi.fn(),
    credentialProvider: '1',
    selectCredentialProvider: test.vi.fn(),
    setSetup: test.vi.fn(),
    saveApiKey: test.vi.fn()
  };
}

test.stable('keeps account actions separate from localized model controls without requests', () => {
  const fetch = test.vi.spyOn(globalThis, 'fetch');
  const model = settingsModel();

  const { rerender, container } = test.render(<AiAccountSettingsView model={model} />);

  test.expect(test.screen.getByText('learner@example.com')).toBeInTheDocument();
  test.expect(test.screen.getByRole('button', { name: 'Esci' })).toBeEnabled();
  test.expect(test.screen.getByRole('combobox')).toBeInTheDocument();
  rerender(<AiModelSettingsView model={model} />);
  test.expect(test.screen.queryByText('learner@example.com')).not.toBeInTheDocument();
  test.expect(test.screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument();
  test.expect(test.screen.getAllByRole('combobox')).toHaveLength(3);
  test.expect(container.querySelectorAll('.settings-group')).toHaveLength(1);
  test.expect(container.querySelector('.settings-group')?.children).toHaveLength(3);
  test.expect(fetch).not.toHaveBeenCalled();
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

test.stable('credential selection renders exactly one provider dropdown and password input', () => {
  const model = withAnthropic();

  model.credentialProvider = 'anthropic';
  test.render(<AiAccountSettingsView model={model} />);
  test.expect(test.screen.getAllByRole('combobox')).toHaveLength(1);
  test.expect(test.screen.getByLabelText('Chiave API')).toHaveAttribute('type', 'password');
});

test.stable(
  'model dropdowns offer registered provider models and commit the selected ID',
  async () => {
    const model = withAnthropic();

    test.render(<AiModelSettingsView model={model} />);
    test.expect(test.screen.queryByRole('textbox')).not.toBeInTheDocument();
    await test.userEvent.click(test.screen.getByRole('combobox', { name: 'Attività rapide' }));
    test
      .expect((await test.screen.findAllByRole('option')).map((option) => option.textContent))
      .toStrictEqual([
        'ChatGPT — Usa predefinito',
        'ChatGPT — GPT-6 Luna',
        'ChatGPT — GPT-6.1 Sol',
        'ChatGPT — GPT-6 Astra',
        'Anthropic — Usa predefinito',
        'Anthropic — claude-haiku-5-5',
        'Anthropic — claude-sonnet-5-5',
        'Anthropic — claude-opus-5-5'
      ]);
    await test.userEvent.click(
      await test.screen.findByRole('option', { name: 'Anthropic — claude-opus-5-5' })
    );
    test.expect(model.setSetup).toHaveBeenCalledWith('tiny', {
      provider: 'anthropic',
      model: 'claude-opus-5-5'
    });
  }
);

test.stable('a single choice changes provider and model together', async () => {
  const model = withAnthropic();

  test.render(<AiModelSettingsView model={model} />);
  await test.userEvent.click(test.screen.getByRole('combobox', { name: 'Attività complesse' }));
  await test.userEvent.click(
    await test.screen.findByRole('option', { name: 'Anthropic — claude-sonnet-5-5' })
  );
  test.expect(model.setSetup).toHaveBeenCalledExactlyOnceWith('smart', {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5'
  });
});

test.stable('saved custom models retain their selected provider and label', async () => {
  const model = withAnthropic();

  model.data = {
    ...model.data!,
    settings: {
      ...model.data!.settings,
      tiny: { provider: 'anthropic', model: 'custom-model' }
    }
  };
  test.render(<AiModelSettingsView model={model} />);
  test
    .expect(test.screen.getByRole('combobox', { name: 'Attività rapide' }))
    .toHaveTextContent('Anthropic — custom-model');
  await test.userEvent.click(test.screen.getByRole('combobox', { name: 'Attività rapide' }));
  await test.userEvent.click(
    await test.screen.findByRole('option', { name: 'ChatGPT — Usa predefinito' })
  );
  test.expect(model.setSetup).toHaveBeenCalledExactlyOnceWith('tiny', { provider: 1 });
});

test.stable(
  'signed-out ChatGPT is absent unless it is the saved choice, which stays disabled',
  async () => {
    const model = withAnthropic();

    model.data = { ...model.data!, status: { signedIn: false, email: null, sharing: false } };
    test.render(<AiModelSettingsView model={model} />);
    await test.userEvent.click(test.screen.getByRole('combobox', { name: 'Attività rapide' }));
    test
      .expect(await test.screen.findByRole('option', { name: 'Anthropic — Usa predefinito' }))
      .toBeEnabled();
    test.expect(test.screen.queryByRole('option', { name: /ChatGPT/ })).not.toBeInTheDocument();
    await test.userEvent.keyboard('{Escape}');
    await test.userEvent.click(test.screen.getByRole('combobox', { name: 'Attività quotidiane' }));
    test
      .expect(await test.screen.findByRole('option', { name: 'ChatGPT — Usa predefinito' }))
      .toHaveAttribute('aria-disabled', 'true');
    test
      .expect(test.screen.queryByRole('option', { name: 'ChatGPT — GPT-6 Luna' }))
      .not.toBeInTheDocument();
    test.expect(model.setSetup).not.toHaveBeenCalled();
  }
);

test.stable('an API provider without a key retains only its disabled saved model', async () => {
  const model = withAnthropic();
  const provider = model.data!.providers[0]!;

  model.data = {
    ...model.data!,
    providers: [{ ...provider, configured: false }],
    settings: { ...model.data!.settings, tiny: { provider: 'anthropic', model: 'claude-opus-5-5' } }
  };
  test.render(<AiModelSettingsView model={model} />);
  test
    .expect(test.screen.getByRole('combobox', { name: 'Attività rapide' }))
    .toHaveTextContent('Anthropic — claude-opus-5-5');
  await test.userEvent.click(test.screen.getByRole('combobox', { name: 'Attività rapide' }));
  const saved = await test.screen.findByRole('option', { name: 'Anthropic — claude-opus-5-5' });

  test.expect(saved).toHaveAttribute('aria-disabled', 'true');
  test
    .expect(test.screen.queryByRole('option', { name: 'Anthropic — Usa predefinito' }))
    .not.toBeInTheDocument();
  test
    .expect(test.screen.queryByRole('option', { name: 'Anthropic — claude-sonnet-5-5' }))
    .not.toBeInTheDocument();
  await test.userEvent.click(saved);
  test.expect(model.setSetup).not.toHaveBeenCalled();
  await test.userEvent.click(
    await test.screen.findByRole('option', { name: 'ChatGPT — Usa predefinito' })
  );
  test.expect(model.setSetup).toHaveBeenCalledExactlyOnceWith('tiny', { provider: 1 });
});

test.stable(
  'without credentials all saved choices remain visible and controls are disabled',
  () => {
    const model = withAnthropic();

    model.data = {
      ...model.data!,
      status: { signedIn: false, email: null, sharing: false },
      providers: model.data!.providers.map((provider) => ({ ...provider, configured: false }))
    };
    test.render(<AiModelSettingsView model={model} />);

    for (const picker of test.screen.getAllByRole('combobox')) test.expect(picker).toBeDisabled();

    test
      .expect(test.screen.getByRole('combobox', { name: 'Attività rapide' }))
      .toHaveTextContent('Anthropic — Usa predefinito');
    test
      .expect(test.screen.getByRole('combobox', { name: 'Attività quotidiane' }))
      .toHaveTextContent('ChatGPT — Usa predefinito');
    test.expect(model.setSetup).not.toHaveBeenCalled();
  }
);
