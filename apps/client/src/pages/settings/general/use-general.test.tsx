import { testStable } from '@study/testing/vitest';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { Providers } from '#client/app/providers.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { useGeneralSettings } from './use-general';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));

vi.mock('#client/lib/study-client/preferences.ts', () => ({
  loadAppSettings: api.load,
  saveLanguage: api.save
}));

beforeEach(() => {
  api.load
    .mockReset()
    .mockResolvedValue({ language: 2, appearance: 3, zoomPercent: 125, onboarded: true });
  api.save.mockReset();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return renderHook(() => ({ settings: useGeneralSettings(), localization: useI18n() }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Providers queryClient={client}>{children}</Providers>
    )
  });
}

testStable(
  'applies the saved language at startup and updates the whole provider after saving',
  async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.localization.locale).toBe('italian'));
    expect(document.documentElement.lang).toBe('it');
    api.save.mockResolvedValue({ language: 1, appearance: 3, zoomPercent: 125, onboarded: true });
    act(() => result.current.settings.setLanguage('english'));
    await waitFor(() => expect(result.current.localization.locale).toBe('english'));
    expect(api.save).toHaveBeenCalledWith(1);
    expect(document.documentElement.lang).toBe('en');
  }
);

testStable('keeps the saved language when saving fails, then permits recovery', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.localization.locale).toBe('italian'));
  api.save.mockRejectedValue(new Error('offline'));
  act(() => result.current.settings.setLanguage('english'));
  await waitFor(() => expect(result.current.settings.error).toBe(true));
  expect(result.current.localization.locale).toBe('italian');
  expect(result.current.settings.data?.language).toBe(2);
  act(() => result.current.settings.retry());
  await waitFor(() => expect(result.current.settings.error).toBe(false));
});
