import { defaultAppearancePreferences } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { test } from '@study/testing';

import { initializeAppearance } from './appearance';

function createMocks(mock: test.Mock) {
  return { settings: mock.fn(), selected: mock.fn(), themes: mock.fn() };
}

let api: ReturnType<typeof createMocks>;

test.beforeEach(({ mock }) => {
  api = createMocks(mock);
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.appSettings')
      return { language: 1, zoomPercent: 100, onboarded: true, ...(await api.settings(input)) };

    if (tag === 'settings.appearancePreferences') return defaultAppearancePreferences;

    if (tag === 'themes.selectedTheme') return api.selected(input);

    if (tag === 'themes.themes') return api.themes(input);

    throw new Error(tag);
  });

  configureRpcTransport(fixture.transport);
});

let restore: (() => void) | undefined;

test.afterEach(() => restore?.());

test.stable('applies the saved theme and appearance to the document', async () => {
  api.settings.mockResolvedValue({ appearance: 1 });
  api.selected.mockResolvedValue('ocean');
  api.themes.mockResolvedValue({
    items: [
      {
        version: 1,
        builtin: false,
        id: 'ocean',
        name: 'Ocean',
        light: { sidebar: '#eef5ff' },
        dark: { sidebar: '#101828' }
      }
    ],
    next: null
  });
  restore = initializeAppearance(document);
  await test.waitFor(() =>
    test.expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('#eef5ff')
  );
  test.expect(document.documentElement).not.toHaveClass('dark');
});

test.stable('keeps the default dark palette available when the server is unavailable', async () => {
  api.settings.mockRejectedValue(new Error('offline'));
  api.selected.mockResolvedValue(null);
  api.themes.mockResolvedValue({ items: [], next: null });
  restore = initializeAppearance(document);
  await Promise.resolve();
  test.expect(document.documentElement).toHaveClass('dark');
});

test.stable('follows system appearance changes and removes the listener on disposal', async () => {
  let change: ((event: { matches: boolean }) => void) | undefined;
  const remove = test.vi.fn();

  test.vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: test.vi.fn(),
    removeListener: test.vi.fn(),
    dispatchEvent: () => true,
    addEventListener: (_name: string, listener: unknown) => {
      change = listener as typeof change;
    },
    removeEventListener: remove
  });
  api.settings.mockResolvedValue({ appearance: 3 });
  api.selected.mockResolvedValue(null);
  api.themes.mockResolvedValue({ items: [], next: null });
  restore = initializeAppearance(document);
  await test.waitFor(() => test.expect(document.documentElement).toHaveClass('dark'));
  await test.waitFor(() => test.expect(change).toBeDefined());
  change?.({ matches: false });
  await test.waitFor(() => test.expect(document.documentElement).not.toHaveClass('dark'));
  restore();
  restore = undefined;
  test.expect(remove).toHaveBeenCalledWith('change', test.expect.any(Function));
});

test.stable('skips an active navigation snapshot before changing root zoom', async () => {
  let cancel: () => void = () => {};
  const ready = new Promise<void>((_, reject) => {
    cancel = () => reject(new DOMException('Skipped', 'AbortError'));
  });
  const skipTransition = test.vi.fn(() => {
    test.expect(document.documentElement.style.zoom).not.toBe('125%');
    cancel();
  });

  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition, ready }
  });
  api.settings.mockResolvedValue({ appearance: 2, zoomPercent: 125 });
  api.selected.mockResolvedValue(null);
  api.themes.mockResolvedValue({ items: [], next: null });

  try {
    restore = initializeAppearance(document);
    await test.waitFor(() => test.expect(document.documentElement.style.zoom).toBe('125%'));
    test.expect(skipTransition).toHaveBeenCalledOnce();
  } finally {
    Reflect.deleteProperty(document, 'activeViewTransition');
  }
});
