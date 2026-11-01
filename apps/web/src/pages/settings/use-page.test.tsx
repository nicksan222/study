import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vite-plus/test';

import { useAppearance } from './use-page';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), select: vi.fn() }));

vi.mock('../../lib/study-client/operations', () => ({
  loadAppearance: api.load,
  updateAppSettings: api.save,
  saveAppearancePreferences: vi.fn(),
  selectTheme: api.select,
  importTheme: vi.fn(),
  saveTheme: vi.fn(),
  deleteTheme: vi.fn()
}));
vi.mock('../../lib/appearance', () => ({ applyAppearance: vi.fn() }));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return renderHook(() => useAppearance(), { wrapper });
}

it('persists system appearance as a partial change and reloads committed data', async () => {
  const settings = { appearance: 2, language: 2, zoomPercent: 125, onboarded: true };

  api.load.mockResolvedValue({ settings, selected: null, themes: [] });
  api.save.mockResolvedValue({});
  const { result } = setup();

  await waitFor(() => expect(result.current.loading).toBe(false));
  const calls = api.load.mock.calls.length;

  act(() => result.current.setAppearance('system'));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ appearance: 3 }));
  await waitFor(() => expect(api.load.mock.calls.length).toBeGreaterThan(calls));
});

it('keeps the saved selection and exposes recovery when a mutation fails', async () => {
  api.load.mockResolvedValue({ settings: { appearance: 2 }, selected: 'ocean', themes: [] });
  api.select.mockRejectedValue(new Error('offline'));
  const { result } = setup();

  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.selectTheme('iris'));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.data?.selected).toBe('ocean');
});
