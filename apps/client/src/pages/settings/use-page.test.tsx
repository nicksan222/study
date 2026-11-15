import { projectIdSchema, defaultAppearancePreferences } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { useAppearance, usePage } from './use-page';

const router = vi.hoisted(() => ({ scope: {} as { project?: string }, navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => router.scope,
  useNavigate: () => router.navigate
}));

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), select: vi.fn() }));

vi.mock('#client/lib/study-client/types.ts', () => ({
  loadAppearance: api.load,
  updateAppSettings: api.save,
  saveAppearancePreferences: vi.fn(),
  selectTheme: api.select,
  importTheme: vi.fn(),
  saveTheme: vi.fn(),
  deleteTheme: vi.fn()
}));
vi.mock('#client/lib/appearance.ts', () => ({ applyAppearance: vi.fn() }));

function setup<T>(hook: () => T) {
  const fixture = settingsTransport(async (tag, input) => {
    if (tag === 'settings.appSettings') return (await api.load()).settings;

    if (tag === 'settings.appearancePreferences') return defaultAppearancePreferences;

    if (tag === 'themes.selectedTheme') return (await api.load()).selected;

    if (tag === 'themes.themes') return { items: (await api.load()).themes, next: null };

    if (tag === 'settings.saveAppSettings') return api.save(input);

    if (tag === 'themes.selectTheme') return api.select(input);

    throw new Error(tag);
  });

  return renderHook(hook, { wrapper: fixture.wrapper });
}

testStable(
  'persists system appearance as a partial change and reloads committed data',
  async () => {
    const settings = { appearance: 2, language: 2, zoomPercent: 125, onboarded: true };

    api.load.mockResolvedValue({ settings, selected: null, themes: [] });
    api.save.mockResolvedValue({});
    const { result } = setup(useAppearance);

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setAppearance('system'));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ ...settings, appearance: 3 }));
  }
);

testStable('keeps the saved selection and exposes recovery when a mutation fails', async () => {
  api.load.mockResolvedValue({
    settings: { appearance: 2, language: 2, zoomPercent: 100, onboarded: true },
    selected: 'ocean',
    themes: []
  });
  api.select.mockRejectedValue(new Error('offline'));
  const { result } = setup(useAppearance);

  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.selectTheme('iris'));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.data?.selected).toBe('ocean');
});

testStable.each([
  [undefined, projectIdSchema.make(41n), projectIdSchema.make(41n), true],
  ['41', undefined, projectIdSchema.make(41n), true],
  [undefined, projectIdSchema.make(41n), projectIdSchema.make(42n), false],
  [undefined, undefined, projectIdSchema.make(41n), false]
])(
  'redirects only when deleting the resolved workspace or URL subject (%s, %s, %s)',
  (scope, workspace, deleted, redirect) => {
    router.scope = scope ? { project: scope } : {};
    router.navigate.mockClear();
    const { result } = setup(() => usePage(undefined, 'projects', workspace));

    act(() => result.current.onProjectDeleted(deleted));

    if (redirect)
      expect(router.navigate).toHaveBeenCalledWith({ to: '/notes', search: {}, replace: true });
    else expect(router.navigate).not.toHaveBeenCalled();
  }
);

testStable('clears a deleted stale URL subject without leaving the resolved note', () => {
  router.scope = { project: '41' };
  router.navigate.mockClear();
  const { result } = setup(() => usePage(undefined, 'projects', projectIdSchema.make(42n)));

  act(() => result.current.onProjectDeleted(projectIdSchema.make(41n)));
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({
    to: '.',
    search: expect.any(Function),
    replace: true
  });
  const search = router.navigate.mock.calls[0]![0].search;

  expect(search({ project: '41', version: '9' })).toEqual({ project: undefined, version: '9' });
});
