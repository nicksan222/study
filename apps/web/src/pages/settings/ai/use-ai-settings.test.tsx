import { catalogs } from '@study/localization';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import * as operations from '../../../lib/study-client/ai-settings';
import { AiSettings } from './index';

vi.mock('../../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: keyof typeof catalogs.english) => catalogs.english[key] })
}));
vi.mock('../../../lib/study-client/ai-settings', () => ({
  loadAiSettings: vi.fn(),
  startChatGptSignIn: vi.fn(),
  finishChatGptSignIn: vi.fn(),
  cancelChatGptSignIn: vi.fn(),
  signOutChatGpt: vi.fn(),
  saveAiSettings: vi.fn()
}));

const settings = {
  tiny: { provider: 1, model: 1 },
  medium: { provider: 1, model: 2 },
  smart: { provider: 1, model: 3 }
} as const;

function mount() {
  vi.mocked(operations.loadAiSettings).mockResolvedValue({
    settings,
    status: { signedIn: false, email: null, sharing: false }
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <AiSettings />
    </QueryClientProvider>
  );
}

it('saves a canonical model change while preserving the other tiers', async () => {
  vi.mocked(operations.saveAiSettings).mockResolvedValue({});
  mount();
  const user = userEvent.setup();

  await user.click(await screen.findByRole('combobox', { name: 'Everyday tasks' }));
  await user.click(await screen.findByRole('option', { name: 'GPT-6 Astra' }));
  await waitFor(() =>
    expect(operations.saveAiSettings).toHaveBeenCalledWith({
      ...settings,
      medium: { provider: 1, model: 3 }
    })
  );
  expect(operations.startChatGptSignIn).not.toHaveBeenCalled();
});

it('keeps cancellation available while completion waits and cancels only its own attempt', async () => {
  vi.mocked(operations.startChatGptSignIn).mockResolvedValue({
    url: 'https://auth.openai.com/test',
    attemptId: 'owned-attempt'
  });
  vi.mocked(operations.finishChatGptSignIn).mockImplementation(
    (_id, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
  );
  vi.mocked(operations.cancelChatGptSignIn).mockResolvedValue(true);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  expect(await screen.findByRole('link', { name: 'Open ChatGPT sign-in' })).toHaveAttribute(
    'href',
    'https://auth.openai.com/test'
  );
  fireEvent.click(screen.getByRole('button', { name: 'I completed sign-in' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'I completed sign-in' })).toBeDisabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
  await waitFor(() => expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('owned-attempt'));
  expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
});

it('disposes an owned attempt when the section closes', async () => {
  vi.mocked(operations.startChatGptSignIn).mockResolvedValue({
    url: 'https://auth.openai.com/test',
    attemptId: 'closing-attempt'
  });
  vi.mocked(operations.cancelChatGptSignIn).mockResolvedValue(true);
  const view = mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await screen.findByRole('link', { name: 'Open ChatGPT sign-in' });
  view.unmount();
  await waitFor(() =>
    expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('closing-attempt')
  );
});
