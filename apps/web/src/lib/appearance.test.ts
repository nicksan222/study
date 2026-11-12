import { testStable } from '@study/testing/vitest';
import { waitFor } from '@testing-library/react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { initializeAppearance } from './appearance';

const api = vi.hoisted(() => ({ settings: vi.fn(), selected: vi.fn(), themes: vi.fn() }));

vi.mock('./study-client/client', async () => {
  const { Effect } = await import('effect');
  const call = (fn: typeof api.settings) => (input: unknown) => Effect.tryPromise(() => fn(input));
  const client = {
    'settings.appSettings': call(api.settings),
    'settings.appearancePreferences': () =>
      Effect.succeed({ contrast: 100, glassOpacity: 80, animationDurationMs: 150 }),
    'themes.selectedTheme': call(api.selected),
    'themes.themes': call(api.themes)
  };

  return {
    studyClient: Effect.succeed(client)
  };
});

let restore: (() => void) | undefined;

afterEach(() => restore?.());

testStable('applies the saved theme and appearance to the document', async () => {
  api.settings.mockResolvedValue({ appearance: 1 });
  api.selected.mockResolvedValue('ocean');
  api.themes.mockResolvedValue({
    items: [{ id: 'ocean', light: { sidebar: '#eef5ff' }, dark: { sidebar: '#101828' } }],
    next: null
  });
  restore = initializeAppearance(document);
  await waitFor(() =>
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('#eef5ff')
  );
  expect(document.documentElement).not.toHaveClass('dark');
});

testStable('keeps the default dark palette available when the server is unavailable', async () => {
  api.settings.mockRejectedValue(new Error('offline'));
  api.selected.mockResolvedValue(null);
  api.themes.mockResolvedValue({ items: [], next: null });
  restore = initializeAppearance(document);
  await Promise.resolve();
  expect(document.documentElement).toHaveClass('dark');
});

testStable('follows system appearance changes and removes the listener on disposal', async () => {
  let change: ((event: { matches: boolean }) => void) | undefined;
  const remove = vi.fn();

  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
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
  await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  await waitFor(() => expect(change).toBeDefined());
  change?.({ matches: false });
  await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
  restore();
  restore = undefined;
  expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
});

testStable('skips an active navigation snapshot before changing root zoom', async () => {
  let cancel: () => void = () => {};
  const ready = new Promise<void>((_, reject) => {
    cancel = () => reject(new DOMException('Skipped', 'AbortError'));
  });
  const skipTransition = vi.fn(() => {
    expect(document.documentElement.style.zoom).not.toBe('125%');
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
    await waitFor(() => expect(document.documentElement.style.zoom).toBe('125%'));
    expect(skipTransition).toHaveBeenCalledOnce();
  } finally {
    Reflect.deleteProperty(document, 'activeViewTransition');
  }
});
