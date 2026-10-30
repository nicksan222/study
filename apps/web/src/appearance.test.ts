import { waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { initializeAppearance } from './appearance';

const api = vi.hoisted(() => ({ settings: vi.fn(), selected: vi.fn(), themes: vi.fn() }));

vi.mock('./study-client', () => ({
  studyClient: {
    settings: { getAppSettings: { query: api.settings } },
    themes: { selected: { query: api.selected }, list: { query: api.themes } }
  }
}));

let restore: (() => void) | undefined;

afterEach(() => restore?.());

it('applies the saved theme and appearance to the document', async () => {
  api.settings.mockResolvedValue({ appearance: 1 });
  api.selected.mockResolvedValue('ocean');
  api.themes.mockResolvedValue([
    { id: 'ocean', light: { sidebar: '#eef5ff' }, dark: { sidebar: '#101828' } }
  ]);
  restore = initializeAppearance(document);
  await waitFor(() =>
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('#eef5ff')
  );
  expect(document.documentElement).not.toHaveClass('dark');
});

it('keeps the default dark palette available when the server is unavailable', async () => {
  api.settings.mockRejectedValue(new Error('offline'));
  api.selected.mockResolvedValue(null);
  api.themes.mockResolvedValue([]);
  restore = initializeAppearance(document);
  await Promise.resolve();
  expect(document.documentElement).toHaveClass('dark');
});
