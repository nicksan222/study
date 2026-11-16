import { workspacePreferencesSchema, defaultWorkspacePreferences } from '@study/contracts';
import type { WorkspacePreferences } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __StudyMockType0 from '#client/pages/settings/workspace-settings.tsx';

function createApi(mock: test.Mock) {
  return {
    strategies: mock.fn<() => Promise<unknown[]>>(),
    read: mock.fn<() => Promise<WorkspacePreferences>>(),
    save: mock.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>()
  };
}

let api: ReturnType<typeof createApi>;

let AiWritingSettings: typeof __StudyMockType0.AiWritingSettings;

let WritingSettings: typeof __StudyMockType0.WritingSettings;

test.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __studyMockModule0 = await import('./workspace-settings');

  AiWritingSettings = __studyMockModule0.AiWritingSettings;
  WritingSettings = __studyMockModule0.WritingSettings;
});

test.beforeEach(() => {
  test.vi.clearAllMocks();
  api.read.mockResolvedValue(defaultWorkspacePreferences);
  api.strategies.mockResolvedValue([
    { id: 'chatgpt', name: 'ChatGPT', supportedInputs: ['text', 'pdf'] }
  ]);
});

function mount(ai = false) {
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.workspacePreferences') return api.read();

    if (tag === 'sources.conversionStrategies') return api.strategies();

    if (tag === 'settings.saveWorkspacePreferences') {
      const value = Schema.decodeUnknownSync(workspacePreferencesSchema)(input);

      await api.save(value);

      api.read.mockResolvedValue(value);
      await fixture.notify();

      return {};
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  test.render(ai ? <AiWritingSettings /> : <WritingSettings />, { wrapper: fixture.wrapper });

  return fixture;
}

test.stable(
  'retains a rejected numeric draft through recovery and retries the exact value',
  async () => {
    api.save
      .mockRejectedValueOnce(new Error('Save unavailable'))
      .mockImplementationOnce(async (value) => {
        api.read.mockResolvedValue(value);

        return value;
      });
    mount();
    const input = await test.screen.findByRole('spinbutton', { name: 'WorkspaceAutosave' });

    test.fireEvent.change(input, { target: { value: '8' } });
    const form = input.closest('form');

    test.assert.ok(form, 'Autosave controls require a form');

    test.fireEvent.click(test.within(form).getByRole('button', { name: 'Save' }));
    test.expect(await test.screen.findByText('WorkspaceSettingsFailed')).toBeInTheDocument();
    test.expect(input).toHaveValue(8);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByText('WorkspaceSettingsFailed')).toBeNull()
    );
    test.expect(input).toHaveValue(8);
    test.fireEvent.click(test.within(form).getByRole('button', { name: 'Save' }));
    await test.screen.findByText('WorkspaceSettingsSaved');
    test.expect(api.save).toHaveBeenNthCalledWith(2, {
      ...defaultWorkspacePreferences,
      autosaveIntervalSeconds: 8
    });
    test.expect(input).toHaveValue(8);
    await test.waitFor(() =>
      test.expect(test.within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
    );
  }
);

test.stable('saves a switch and reflects the confirmed persisted value', async () => {
  api.save.mockImplementation(async (value) => {
    api.read.mockResolvedValue(value);

    return value;
  });
  mount();
  const toggle = await test.screen.findByRole('switch', { name: 'WorkspaceSpellcheck' });

  test.expect(toggle).toBeChecked();
  test.fireEvent.click(toggle);
  await test.waitFor(() =>
    test
      .expect(api.save)
      .toHaveBeenCalledWith({ ...defaultWorkspacePreferences, spellcheck: false })
  );
  await test.waitFor(() => test.expect(toggle).not.toBeChecked());
  test.expect(await test.screen.findByText('WorkspaceSettingsSaved')).toBeInTheDocument();
});

test.stable('keeps automatic answers opt-in and persists the confirmed preference', async () => {
  api.save.mockImplementation(async (value) => {
    api.read.mockResolvedValue(value);

    return value;
  });
  mount(true);
  const toggle = await test.screen.findByRole('switch', { name: 'WorkspaceAutoAnswerQuestions' });

  test.expect(toggle).not.toBeChecked();
  test.fireEvent.click(toggle);
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenCalledWith({
      ...defaultWorkspacePreferences,
      autoAnswerQuestions: true
    })
  );
  await test.waitFor(() => test.expect(toggle).toBeChecked());
});

test.stable('offers manual conversion by default and discovers the available method', async () => {
  mount(true);
  test
    .expect(await test.screen.findByRole('combobox', { name: 'WorkspaceConversionMode' }))
    .toHaveTextContent('WorkspaceConversionManual');
  test.expect(await test.screen.findByText('ChatGPT')).toBeVisible();
});

test.stable('persists automatic conversion only after an explicit mode selection', async () => {
  api.save.mockImplementation(async (value) => {
    api.read.mockResolvedValue(value);

    return value;
  });
  const user = test.userEvent.setup();

  mount(true);
  await user.click(await test.screen.findByRole('combobox', { name: 'WorkspaceConversionMode' }));
  await user.click(
    await test.screen.findByRole('option', { name: 'WorkspaceConversionAutomatic' })
  );
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenCalledWith({
      ...defaultWorkspacePreferences,
      textConversionMode: 'automatic'
    })
  );
  await test.waitFor(() =>
    test
      .expect(test.screen.getByRole('combobox', { name: 'WorkspaceConversionMode' }))
      .toHaveTextContent('WorkspaceConversionAutomatic')
  );
});

test.stable(
  'replaces an unavailable saved strategy even when only one method is available',
  async () => {
    api.read.mockResolvedValue({
      ...defaultWorkspacePreferences,
      textConversionStrategy: 'removed'
    });
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    const user = test.userEvent.setup();

    mount(true);
    test.expect(await test.screen.findByText('WorkspaceConversionUnavailable')).toBeVisible();
    const select = test.screen.getByRole('combobox', { name: 'WorkspaceConversionStrategy' });

    test.expect(select).toBeEnabled();
    await user.click(select);
    await user.click(await test.screen.findByRole('option', { name: 'ChatGPT' }));
    await test.waitFor(() =>
      test.expect(api.save).toHaveBeenCalledWith({
        ...defaultWorkspacePreferences,
        textConversionStrategy: 'chatgpt'
      })
    );
    await test.waitFor(() =>
      test.expect(test.screen.queryByText('WorkspaceConversionUnavailable')).not.toBeInTheDocument()
    );
  }
);

test.stable('recovers strategy discovery through its retry action', async () => {
  api.strategies.mockRejectedValueOnce(new Error('Disconnected'));
  const user = test.userEvent.setup();

  mount(true);
  test.expect(await test.screen.findByText('WorkspaceSettingsFailed')).toBeVisible();
  await user.click(test.screen.getByRole('button', { name: 'Retry' }));
  test.expect(await test.screen.findByText('ChatGPT')).toBeVisible();
  test.expect(api.strategies).toHaveBeenCalledTimes(2);
});
