import { projectIdSchema, defaultAppearancePreferences } from '@study/contracts';
import { test } from '@study/testing';

import type * as __StudyMockType0 from '#client/pages/settings/use-page.ts';

function createRouter(mock: test.Mock) {
  return { scope: {} as { project?: string }, navigate: mock.fn() };
}

let router: ReturnType<typeof createRouter>;

function createApi(mock: test.Mock) {
  return { load: mock.fn(), save: mock.fn(), select: mock.fn() };
}

let api: ReturnType<typeof createApi>;

let useAppearance: typeof __StudyMockType0.useAppearance;

let usePage: typeof __StudyMockType0.usePage;

test.beforeEach(async ({ mock }) => {
  router = createRouter(mock);
  api = createApi(mock);
  mock('@tanstack/react-router', () => ({
    useSearch: () => router.scope,
    useNavigate: () => router.navigate
  }));
  mock('#client/lib/study-client/types.ts', () => ({
    loadAppearance: api.load,
    updateAppSettings: api.save,
    saveAppearancePreferences: mock.fn(),
    selectTheme: api.select,
    importTheme: mock.fn(),
    saveTheme: mock.fn(),
    deleteTheme: mock.fn()
  }));
  mock('#client/lib/appearance.ts', () => ({ applyAppearance: mock.fn() }));
  const __studyMockModule0 = await import('./use-page');

  useAppearance = __studyMockModule0.useAppearance;
  usePage = __studyMockModule0.usePage;
});

function setup<T>(hook: () => T) {
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.appSettings') return (await api.load()).settings;

    if (tag === 'settings.appearancePreferences') return defaultAppearancePreferences;

    if (tag === 'themes.selectedTheme') return (await api.load()).selected;

    if (tag === 'themes.themes') return { items: (await api.load()).themes, next: null };

    if (tag === 'settings.saveAppSettings') return api.save(input);

    if (tag === 'themes.selectTheme') return api.select(input);

    throw new Error(tag);
  });

  return test.renderHook(hook, { wrapper: fixture.wrapper });
}

test.stable(
  'persists system appearance as a partial change and reloads committed data',
  async () => {
    const settings = { appearance: 2, language: 2, zoomPercent: 125, onboarded: true };

    api.load.mockResolvedValue({ settings, selected: null, themes: [] });
    api.save.mockResolvedValue({});
    const { result } = setup(useAppearance);

    await test.waitFor(() => test.expect(result.current.loading).toBe(false));

    test.act(() => result.current.setAppearance('system'));
    await test.waitFor(() =>
      test.expect(api.save).toHaveBeenCalledWith({ ...settings, appearance: 3 })
    );
  }
);

test.stable('keeps the saved selection and exposes recovery when a mutation fails', async () => {
  api.load.mockResolvedValue({
    settings: { appearance: 2, language: 2, zoomPercent: 100, onboarded: true },
    selected: 'ocean',
    themes: []
  });
  api.select.mockRejectedValue(new Error('offline'));
  const { result } = setup(useAppearance);

  await test.waitFor(() => test.expect(result.current.loading).toBe(false));
  test.act(() => result.current.selectTheme('iris'));
  await test.waitFor(() => test.expect(result.current.error).toBe(true));
  test.expect(result.current.data?.selected).toBe('ocean');
});

test.stable.each([
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

    test.act(() => result.current.onProjectDeleted(deleted));

    if (redirect)
      test
        .expect(router.navigate)
        .toHaveBeenCalledWith({ to: '/notes', search: {}, replace: true });
    else test.expect(router.navigate).not.toHaveBeenCalled();
  }
);

test.stable('clears a deleted stale URL subject without leaving the resolved note', () => {
  router.scope = { project: '41' };
  router.navigate.mockClear();
  const { result } = setup(() => usePage(undefined, 'projects', projectIdSchema.make(42n)));

  test.act(() => result.current.onProjectDeleted(projectIdSchema.make(41n)));
  test.expect(router.navigate).toHaveBeenCalledExactlyOnceWith({
    to: '.',
    search: test.expect.any(Function),
    replace: true
  });
  const search = router.navigate.mock.calls[0]![0].search;

  test
    .expect(search({ project: '41', version: '9' }))
    .toEqual({ project: undefined, version: '9' });
});
