import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import type { WorkspacePreferences } from '@study/contracts/settings/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { WritingSettings } from './workspace-settings';

const api = vi.hoisted(() => ({
  read: vi.fn<() => Promise<WorkspacePreferences>>(),
  save: vi.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>()
}));

vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/study-client/request', () => ({
  request: (
    invoke: (rpc: {
      'settings.workspacePreferences': typeof api.read;
      'settings.saveWorkspacePreferences': typeof api.save;
    }) => unknown
  ) =>
    invoke({
      'settings.workspacePreferences': api.read,
      'settings.saveWorkspacePreferences': api.save
    })
}));

const caches: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(defaultWorkspacePreferences);
});
afterEach(() => {
  for (const cache of caches) cache.clear();

  caches.length = 0;
});

function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <WritingSettings />
    </QueryClientProvider>
  );
}

it('retains a rejected numeric draft through recovery and retries the exact value', async () => {
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

  if (!form) throw new Error('Autosave controls require a form');

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
});

it('saves a switch and reflects the confirmed persisted value', async () => {
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
