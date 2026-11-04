import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import type { WorkspacePreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import {
  useWorkspacePreferences,
  useWorkspacePreferenceControls
} from './workspace-preferences.queries';

const api = vi.hoisted(() => ({
  read: vi.fn<() => Promise<WorkspacePreferences>>(),
  save: vi.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>()
}));

vi.mock('./request', () => ({
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

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const cache of caches) cache.clear();

  caches.length = 0;
});

function wrapper() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  caches.push(cache);

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
}

testStable('uses canonical defaults when preferences cannot be loaded', async () => {
  api.read.mockRejectedValue(new Error('Disconnected'));
  const view = renderHook(() => useWorkspacePreferences(), { wrapper: wrapper() });

  await waitFor(() => expect(api.read).toHaveBeenCalled());
  expect(view.result.current).toEqual(defaultWorkspacePreferences);
});

testStable(
  'reads fresh preferences before a partial save and preserves another window’s changes',
  async () => {
    const fresh = {
      ...defaultWorkspacePreferences,
      readerFontSize: 22,
      sidebarDensity: 'compact' as const
    };

    api.read.mockResolvedValueOnce(defaultWorkspacePreferences).mockResolvedValue(fresh);
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    const view = renderHook(() => useWorkspacePreferenceControls(), { wrapper: wrapper() });

    await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
    await act(async () => {
      await view.result.current.mutation.mutateAsync({ spellcheck: false });
    });
    expect(api.save).toHaveBeenCalledWith({ ...fresh, spellcheck: false });
    await waitFor(() =>
      expect(view.result.current.query.data).toEqual({ ...fresh, spellcheck: false })
    );
  }
);
