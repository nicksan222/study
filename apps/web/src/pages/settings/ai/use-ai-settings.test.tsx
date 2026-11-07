import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, vi } from 'vite-plus/test';

import * as operations from '#web/lib/study-client/ai-settings.ts';

import { AiAccountSettings, AiModelSettings } from './index';

const runtime = vi.hoisted(() => ({ native: false, openUrl: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => runtime.native }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: runtime.openUrl }));
beforeEach(() => {
  runtime.native = false;
  runtime.openUrl.mockReset().mockResolvedValue(undefined);
});

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: keyof typeof catalogs.english) => catalogs.english[key] })
}));
vi.mock('#web/lib/study-client/ai-settings.ts', () => ({
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

function mount(Section = AiAccountSettings) {
  vi.mocked(operations.loadAiSettings).mockResolvedValue({
    settings,
    status: { signedIn: false, email: null, sharing: false }
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <Section />
    </QueryClientProvider>
  );
}

testStable('saves a canonical model change while preserving the other tiers', async () => {
  vi.mocked(operations.saveAiSettings).mockResolvedValue({});
  mount(AiModelSettings);
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

function browserWindow() {
  const popup = { location: { replace: vi.fn() }, close: vi.fn(), closed: false, opener: window };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

  return { popup, open };
}

function pendingSignIn(attemptId: string) {
  vi.mocked(operations.startChatGptSignIn).mockResolvedValue({
    url: 'https://auth.openai.com/test',
    attemptId
  });
  vi.mocked(operations.finishChatGptSignIn).mockImplementation(
    (_id, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
  );
  vi.mocked(operations.cancelChatGptSignIn).mockResolvedValue(true);
}

testStable('opens ChatGPT immediately and waits automatically with only a spinner', async () => {
  const { popup, open } = browserWindow();

  pendingSignIn('owned-attempt');
  const view = mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  await waitFor(() =>
    expect(popup.location.replace).toHaveBeenCalledWith('https://auth.openai.com/test')
  );
  await waitFor(() =>
    expect(operations.finishChatGptSignIn).toHaveBeenCalledWith(
      'owned-attempt',
      expect.any(AbortSignal)
    )
  );
  expect(
    screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting }).tagName.toLowerCase()
  ).toBe('svg');
  expect(screen.queryByRole('link', { name: 'Open ChatGPT sign-in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'I completed sign-in' })).not.toBeInTheDocument();
  expect(screen.queryByText(catalogs.english.AiSettingsWaiting)).not.toBeInTheDocument();
  view.unmount();
  await waitFor(() => expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('owned-attempt'));
  expect(popup.close).toHaveBeenCalled();
});

testStable('offers a recovery link when the browser blocks the sign-in tab', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  pendingSignIn('blocked-attempt');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  expect(await screen.findByRole('link', { name: 'Open ChatGPT sign-in' })).toHaveAttribute(
    'href',
    'https://auth.openai.com/test'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
  await waitFor(() =>
    expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('blocked-attempt')
  );
  expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
});

testStable('closes the sign-in tab when starting authorization fails', async () => {
  const { popup } = browserWindow();

  vi.mocked(operations.startChatGptSignIn).mockRejectedValue(new Error('Unavailable'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await waitFor(() => expect(popup.close).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
});

testStable(
  'finishes automatically, refreshes the account, and closes the browser tab',
  async () => {
    const { popup } = browserWindow();

    pendingSignIn('completed-attempt');
    vi.mocked(operations.finishChatGptSignIn).mockImplementation(async () => {
      vi.mocked(operations.loadAiSettings).mockResolvedValue({
        settings,
        status: { signedIn: true, email: 'learner@example.com', sharing: true }
      });

      return { signedIn: true, email: 'learner@example.com', sharing: true };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(screen.getByText('learner@example.com')).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  }
);

testStable('a failed sign-in clears the spinner and allows another attempt', async () => {
  const { popup } = browserWindow();

  pendingSignIn('failed-attempt');
  vi.mocked(operations.finishChatGptSignIn).mockRejectedValue(new Error('Declined'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await waitFor(() => expect(popup.close).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
  expect(
    screen.queryByRole('status', { name: catalogs.english.AiSettingsWaiting })
  ).not.toBeInTheDocument();
});

testStable('a cancelled completion cannot clear or close its replacement sign-in', async () => {
  const { popup, open } = browserWindow();

  open.mockReturnValueOnce(null);
  pendingSignIn('replacement-attempt');
  vi.mocked(operations.startChatGptSignIn).mockResolvedValueOnce({
    url: 'https://auth.openai.com/test',
    attemptId: 'old-attempt'
  });
  let rejectOld!: (error: Error) => void;

  vi.mocked(operations.finishChatGptSignIn).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      })
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await waitFor(() =>
    expect(operations.finishChatGptSignIn).toHaveBeenLastCalledWith(
      'replacement-attempt',
      expect.any(AbortSignal)
    )
  );
  await act(async () => {
    rejectOld(new Error('Cancelled'));
  });
  expect(
    screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting })
  ).toBeInTheDocument();
  expect(popup.close).not.toHaveBeenCalled();
});

testStable(
  'unsupported browser origins show localized sign-in guidance and close the blank tab',
  async () => {
    const { popup } = browserWindow();

    vi.mocked(operations.startChatGptSignIn).mockRejectedValue(
      new StudyError('unsupported', 'Loopback required')
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    expect(await screen.findByText(catalogs.english.AiSettingsSignInLocalOnly)).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  }
);

testStable('native sign-in opens the system browser without a webview popup', async () => {
  runtime.native = true;
  const { open } = browserWindow();

  pendingSignIn('native-attempt');
  const view = mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await waitFor(() => expect(runtime.openUrl).toHaveBeenCalledWith('https://auth.openai.com/test'));
  expect(open).not.toHaveBeenCalled();
  expect(
    screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting })
  ).toBeInTheDocument();
  view.unmount();
  await waitFor(() =>
    expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('native-attempt')
  );
});

testStable(
  'a native browser launch failure cancels its attempt instead of waiting forever',
  async () => {
    runtime.native = true;
    runtime.openUrl.mockRejectedValue(new Error('No browser'));
    pendingSignIn('native-failed-attempt');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await waitFor(() =>
      expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('native-failed-attempt')
    );
    expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
  }
);
