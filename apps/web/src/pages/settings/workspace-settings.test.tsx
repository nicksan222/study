import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import type { WorkspacePreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, assert, beforeEach, expect, vi } from 'vite-plus/test';

import { AiWritingSettings, WritingSettings } from './workspace-settings';

const api = vi.hoisted(() => ({
  strategies: vi.fn<() => Promise<unknown[]>>(),
  read: vi.fn<() => Promise<WorkspacePreferences>>(),
  save: vi.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>()
}));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (
    invoke: (rpc: {
      'sources.conversionStrategies': typeof api.strategies;
      'settings.workspacePreferences': typeof api.read;
      'settings.saveWorkspacePreferences': typeof api.save;
    }) => unknown
  ) =>
    invoke({
      'sources.conversionStrategies': api.strategies,
      'settings.workspacePreferences': api.read,
      'settings.saveWorkspacePreferences': api.save
    })
}));

const caches: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(defaultWorkspacePreferences);
  api.strategies.mockResolvedValue([
    { id: 'chatgpt', name: 'ChatGPT', supportedInputs: ['text', 'pdf'] }
  ]);
});
afterEach(() => {
  for (const cache of caches) cache.clear();

  caches.length = 0;
});

function mount(ai = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      {ai ? <AiWritingSettings /> : <WritingSettings />}
    </QueryClientProvider>
  );
}

testStable(
  'retains a rejected numeric draft through recovery and retries the exact value',
  async () => {
    api.save
      .mockRejectedValueOnce(new Error('Save unavailable'))
      .mockImplementationOnce(async (value) => {
        api.read.mockResolvedValue(value);

        return value;
      });
    mount();
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
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  }
);

testStable('saves a switch and reflects the confirmed persisted value', async () => {
  api.save.mockImplementation(async (value) => {
    api.read.mockResolvedValue(value);

    return value;
  });
  mount();
  const toggle = await screen.findByRole('switch', { name: 'WorkspaceSpellcheck' });

  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith({ ...defaultWorkspacePreferences, spellcheck: false })
  );
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(await screen.findByText('WorkspaceSettingsSaved')).toBeInTheDocument();
});

testStable('keeps automatic answers opt-in and persists the confirmed preference', async () => {
  api.save.mockImplementation(async (value) => {
    api.read.mockResolvedValue(value);

    return value;
  });
  mount(true);
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
});

testStable('offers manual conversion by default and discovers the available method', async () => {
  mount(true);
  expect(
    await screen.findByRole('combobox', { name: 'WorkspaceConversionMode' })
  ).toHaveTextContent('WorkspaceConversionManual');
  expect(await screen.findByText('ChatGPT')).toBeVisible();
});

testStable('persists automatic conversion only after an explicit mode selection', async () => {
  api.save.mockImplementation(async (value) => {
    api.read.mockResolvedValue(value);

    return value;
  });
  const user = userEvent.setup();

  mount(true);
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
});

testStable(
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
    const user = userEvent.setup();

    mount(true);
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

testStable('recovers strategy discovery through its retry action', async () => {
  api.strategies.mockRejectedValueOnce(new Error('Disconnected'));
  const user = userEvent.setup();

  mount(true);
  expect(await screen.findByText('WorkspaceSettingsFailed')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('ChatGPT')).toBeVisible();
  expect(api.strategies).toHaveBeenCalledTimes(2);
});
