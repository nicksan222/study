import { waitFor } from '@testing-library/react';
import type { Effect as EffectType } from 'effect';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { initializeAppearance } from './appearance';

const api = vi.hoisted(() => ({ settings: vi.fn(), selected: vi.fn(), themes: vi.fn() }));

vi.mock('./study-client', async () => {
  const { Effect } = await import('effect');
  const call = (fn: typeof api.settings) => (input: unknown) => Effect.tryPromise(() => fn(input));
  const client = {
    'settings.appSettings': call(api.settings),
    'themes.selectedTheme': call(api.selected),
    'themes.themes': call(api.themes)
  };

  return {
    runStudy: (f: (rpc: typeof client) => EffectType.Effect<unknown>, signal?: AbortSignal) =>
      Effect.runPromise(f(client), { signal })
  };
});

let restore: (() => void) | undefined;

afterEach(() => restore?.());

it('applies the saved theme and appearance to the document', async () => {
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

it('keeps the default dark palette available when the server is unavailable', async () => {
  api.settings.mockRejectedValue(new Error('offline'));
  api.selected.mockResolvedValue(null);
  api.themes.mockResolvedValue({ items: [], next: null });
  restore = initializeAppearance(document);
  await Promise.resolve();
  expect(document.documentElement).toHaveClass('dark');
});
