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

test.unit.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __studyMockModule0 = await import('./workspace-settings');

  AiWritingSettings = __studyMockModule0.AiWritingSettings;
  WritingSettings = __studyMockModule0.WritingSettings;
});

test.unit.beforeEach(({ vi }) => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(defaultWorkspacePreferences);
  api.strategies.mockResolvedValue([
    { id: 'chatgpt', name: 'ChatGPT', supportedInputs: ['text', 'pdf'] }
  ]);
});

function mount(
  { rpcTestTransport, render }: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>,
  ai = false
) {
  const fixture = rpcTestTransport(async (tag, input) => {
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

  render(ai ? <AiWritingSettings /> : <WritingSettings />, { wrapper: fixture.wrapper });

  return fixture;
}

test.unit.stable(
  'retains a rejected numeric draft through recovery and retries the exact value',
  async ({
    screen,
    fireEvent,
    assert: assertions,
    within,
    expect,
    waitFor,
    rpcTestTransport,
    render
  }) => {
    const assert: test.Assert = assertions;

    api.save
      .mockRejectedValueOnce(new Error('Save unavailable'))
      .mockImplementationOnce(async (value) => {
        api.read.mockResolvedValue(value);

        return value;
      });
    mount({ rpcTestTransport, render });
    const input = await screen.findByRole('spinbutton', { name: 'WorkspaceAutosave' });

    fireEvent.change(input, { target: { value: '8' } });
    const form = input.closest('form');

    assert.ok(form, 'Autosave controls require a form');

    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('WorkspaceSettingsFailed')).toBeInTheDocument();
    expect(input).toHaveValue(8);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('WorkspaceSettingsFailed')).toBeNull());
    expect(input).toHaveValue(8);
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await screen.findByText('WorkspaceSettingsSaved');
    expect(api.save).toHaveBeenNthCalledWith(2, {
      ...defaultWorkspacePreferences,
      autosaveIntervalSeconds: 8
    });
    expect(input).toHaveValue(8);
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled());
  }
);

test.unit.stable(
  'saves a switch and reflects the confirmed persisted value',
  async ({ screen, expect, fireEvent, waitFor, rpcTestTransport, render }) => {
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    mount({ rpcTestTransport, render });
    const toggle = await screen.findByRole('switch', { name: 'WorkspaceSpellcheck' });

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ ...defaultWorkspacePreferences, spellcheck: false })
    );
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(await screen.findByText('WorkspaceSettingsSaved')).toBeInTheDocument();
  }
);

test.unit.stable(
  'keeps automatic answers opt-in and persists the confirmed preference',
  async ({ screen, expect, fireEvent, waitFor, rpcTestTransport, render }) => {
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    mount({ rpcTestTransport, render }, true);
    const toggle = await screen.findByRole('switch', { name: 'WorkspaceAutoAnswerQuestions' });

    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        ...defaultWorkspacePreferences,
        autoAnswerQuestions: true
      })
    );
    await waitFor(() => expect(toggle).toBeChecked());
  }
);

test.unit.stable(
  'offers manual conversion by default and discovers the available method',
  async ({ expect, screen, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render }, true);
    expect(
      await screen.findByRole('combobox', { name: 'WorkspaceConversionMode' })
    ).toHaveTextContent('WorkspaceConversionManual');
    expect(await screen.findByText('ChatGPT')).toBeVisible();
  }
);

test.unit.stable(
  'persists automatic conversion only after an explicit mode selection',
  async ({ userEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    const user = userEvent.setup();

    mount({ rpcTestTransport, render }, true);
    await user.click(await screen.findByRole('combobox', { name: 'WorkspaceConversionMode' }));
    await user.click(await screen.findByRole('option', { name: 'WorkspaceConversionAutomatic' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        ...defaultWorkspacePreferences,
        textConversionMode: 'automatic'
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'WorkspaceConversionMode' })).toHaveTextContent(
        'WorkspaceConversionAutomatic'
      )
    );
  }
);

test.unit.stable(
  'replaces an unavailable saved strategy even when only one method is available',
  async ({ userEvent, expect, screen, waitFor, rpcTestTransport, render }) => {
    api.read.mockResolvedValue({
      ...defaultWorkspacePreferences,
      textConversionStrategy: 'removed'
    });
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    const user = userEvent.setup();

    mount({ rpcTestTransport, render }, true);
    expect(await screen.findByText('WorkspaceConversionUnavailable')).toBeVisible();
    const select = screen.getByRole('combobox', { name: 'WorkspaceConversionStrategy' });

    expect(select).toBeEnabled();
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'ChatGPT' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        ...defaultWorkspacePreferences,
        textConversionStrategy: 'chatgpt'
      })
    );
    await waitFor(() =>
      expect(screen.queryByText('WorkspaceConversionUnavailable')).not.toBeInTheDocument()
    );
  }
);

test.unit.stable(
  'recovers strategy discovery through its retry action',
  async ({ userEvent, expect, screen, rpcTestTransport, render }) => {
    api.strategies.mockRejectedValueOnce(new Error('Disconnected'));
    const user = userEvent.setup();

    mount({ rpcTestTransport, render }, true);
    expect(await screen.findByText('WorkspaceSettingsFailed')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('ChatGPT')).toBeVisible();
    expect(api.strategies).toHaveBeenCalledTimes(2);
  }
);
