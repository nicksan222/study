import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { AiAccountSettingsView, AiModelSettingsView } from './ai.view';
import type { AiSettingsModel } from './use-ai-settings';

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: keyof typeof catalogs.italian) => catalogs.italian[key] })
}));

testStable('keeps account actions separate from localized model controls without requests', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const model: AiSettingsModel = {
    data: {
      status: { signedIn: true, email: 'learner@example.com', sharing: false },
      settings: { tiny: { provider: 1 }, medium: { provider: 1 }, smart: { provider: 1 } }
    },
    loading: false,
    signInUnsupported: false,
    error: false,
    pending: false,
    cancelling: false,
    attempt: undefined,
    popupBlocked: false,
    retry: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    signOut: vi.fn(),
    setModel: vi.fn()
  };

  const { rerender } = render(<AiAccountSettingsView model={model} />);

  expect(screen.getByText('learner@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Esci' })).toBeEnabled();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  rerender(<AiModelSettingsView model={model} />);
  expect(screen.queryByText('learner@example.com')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(3);
  expect(fetch).not.toHaveBeenCalled();
});
