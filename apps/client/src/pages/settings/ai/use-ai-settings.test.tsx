import { llmSettingsSchema, apiKeyInputSchema } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as Host from '#client/lib/host.ts';

import { AiAccountSettings, AiModelSettings } from './index';

const runtime = test.hoisted(() => ({ native: false, openUrl: test.vi.fn() }));

test.mock('#client/lib/host.ts', async (importOriginal) => {
  const host = await importOriginal<typeof Host>();

  return {
    ...host,
    prepareSignInBrowser: () =>
      runtime.native
        ? {
            open: async (url: string) => {
              await runtime.openUrl(url);

              return true;
            },
            close: () => {}
          }
        : host.prepareSignInBrowser()
  };
});
test.beforeEach(() => {
  runtime.native = false;
  runtime.openUrl.mockReset().mockResolvedValue(undefined);
});

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => createLocalization('english')
}));

const operations = test.hoisted(() => ({
  loadAiSettings: test.vi.fn(),
  startChatGptSignIn: test.vi.fn(),
  finishChatGptSignIn: test.vi.fn(),
  cancelChatGptSignIn: test.vi.fn(),
  signOutChatGpt: test.vi.fn(),
  saveAiSettings: test.vi.fn(),
  saveProviderApiKey: test.vi.fn()
}));

const settings = {
  tiny: { provider: 1, model: 1 },
  medium: { provider: 1, model: 2 },
  smart: { provider: 1, model: 3 }
} as const;

function mount(Section = AiAccountSettings) {
  test.vi.mocked(operations.loadAiSettings).mockResolvedValue({
    settings,
    providers: [],
    status: { signedIn: Section === AiModelSettings, email: null, sharing: false }
  });
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'auth.status') return (await operations.loadAiSettings()).status;

    if (tag === 'auth.providers') return (await operations.loadAiSettings()).providers;

    if (tag === 'settings.llmSettings') return (await operations.loadAiSettings()).settings;

    if (tag === 'auth.startSignIn') return operations.startChatGptSignIn();

    if (tag === 'auth.finishSignIn') {
      const value = await operations.finishChatGptSignIn(
        Schema.decodeUnknownSync(Schema.Struct({ attemptId: Schema.String }))(input).attemptId
      );

      await fixture.notify();

      return value;
    }

    if (tag === 'auth.cancelSignIn')
      return operations.cancelChatGptSignIn(
        Schema.decodeUnknownSync(Schema.Struct({ attemptId: Schema.String }))(input).attemptId
      );

    if (tag === 'auth.signOut') return operations.signOutChatGpt();

    if (tag === 'settings.saveLlmSettings')
      return operations.saveAiSettings(Schema.decodeUnknownSync(llmSettingsSchema)(input));

    if (tag === 'auth.saveApiKey')
      return operations.saveProviderApiKey(Schema.decodeUnknownSync(apiKeyInputSchema)(input));

    throw new Error(tag);
  });

  configureRpcTransport(fixture.transport);

  return test.render(<Section />, { wrapper: fixture.wrapper });
}

test.stable('saves a canonical model change while preserving the other tiers', async () => {
  test.vi.mocked(operations.saveAiSettings).mockResolvedValue({});
  mount(AiModelSettings);
  const user = test.userEvent.setup();

  await user.click(
    await test.screen.findByRole('combobox', { name: catalogs.english.AiSettingsMedium })
  );
  await user.click(await test.screen.findByRole('option', { name: 'ChatGPT — GPT-6 Astra' }));
  await test.waitFor(() =>
    test.expect(operations.saveAiSettings).toHaveBeenCalledWith({
      ...settings,
      medium: { provider: 1, model: 3 }
    })
  );
  test.expect(operations.startChatGptSignIn).not.toHaveBeenCalled();
});

function browserWindow() {
  const popup = {
    location: { replace: test.vi.fn() },
    close: test.vi.fn(),
    closed: false,
    opener: window
  };
  const open = test.vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

  return { popup, open };
}

function pendingSignIn(attemptId: string) {
  test.vi.mocked(operations.startChatGptSignIn).mockResolvedValue({
    url: 'https://auth.openai.com/test',
    attemptId
  });
  test.vi.mocked(operations.finishChatGptSignIn).mockImplementation(
    (_id, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
  );
  test.vi.mocked(operations.cancelChatGptSignIn).mockResolvedValue(true);
}

test.stable('opens ChatGPT immediately and waits automatically with only a spinner', async () => {
  const { popup, open } = browserWindow();

  pendingSignIn('owned-attempt');
  const view = mount();

  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  test.expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  await test.waitFor(() =>
    test.expect(popup.location.replace).toHaveBeenCalledWith('https://auth.openai.com/test')
  );
  await test.waitFor(() =>
    test.expect(operations.finishChatGptSignIn).toHaveBeenCalledWith('owned-attempt')
  );
  test
    .expect(
      test.screen
        .getByRole('status', { name: catalogs.english.AiSettingsWaiting })
        .tagName.toLowerCase()
    )
    .toBe('svg');
  test
    .expect(test.screen.queryByRole('link', { name: 'Open ChatGPT sign-in' }))
    .not.toBeInTheDocument();
  test
    .expect(test.screen.queryByRole('button', { name: 'I completed sign-in' }))
    .not.toBeInTheDocument();
  test.expect(test.screen.queryByText(catalogs.english.AiSettingsWaiting)).not.toBeInTheDocument();
  view.unmount();
  await test.waitFor(() =>
    test.expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('owned-attempt')
  );
  test.expect(popup.close).toHaveBeenCalled();
});

test.stable('offers a recovery link when the browser blocks the sign-in tab', async () => {
  test.vi.spyOn(window, 'open').mockReturnValue(null);
  pendingSignIn('blocked-attempt');
  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  test
    .expect(await test.screen.findByRole('link', { name: 'Open ChatGPT sign-in' }))
    .toHaveAttribute('href', 'https://auth.openai.com/test');
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Cancel sign-in' }));
  await test.waitFor(() =>
    test.expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('blocked-attempt')
  );
  test.expect(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
});

test.stable('closes the sign-in tab when starting authorization fails', async () => {
  const { popup } = browserWindow();

  test.vi.mocked(operations.startChatGptSignIn).mockRejectedValue(new Error('Unavailable'));
  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await test.waitFor(() => test.expect(popup.close).toHaveBeenCalled());
  test.expect(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
});

test.stable(
  'finishes automatically, refreshes the account, and closes the browser tab',
  async () => {
    const { popup } = browserWindow();

    pendingSignIn('completed-attempt');
    test.vi.mocked(operations.finishChatGptSignIn).mockImplementation(async () => {
      test.vi.mocked(operations.loadAiSettings).mockResolvedValue({
        settings,
        providers: [],
        status: { signedIn: true, email: 'learner@example.com', sharing: true }
      });

      return { signedIn: true, email: 'learner@example.com', sharing: true };
    });
    mount();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    test.expect(await test.screen.findByRole('button', { name: 'Sign out' })).toBeEnabled();
    test.expect(test.screen.getByText('learner@example.com')).toBeInTheDocument();
    test.expect(popup.close).toHaveBeenCalled();
  }
);

test.stable('a failed sign-in clears the spinner and allows another attempt', async () => {
  const { popup } = browserWindow();

  pendingSignIn('failed-attempt');
  test.vi.mocked(operations.finishChatGptSignIn).mockRejectedValue(new Error('Declined'));
  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await test.waitFor(() => test.expect(popup.close).toHaveBeenCalled());
  test.expect(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
  test
    .expect(test.screen.queryByRole('status', { name: catalogs.english.AiSettingsWaiting }))
    .not.toBeInTheDocument();
});

test.stable('a cancelled completion cannot clear or close its replacement sign-in', async () => {
  const { popup, open } = browserWindow();

  open.mockReturnValueOnce(null);
  pendingSignIn('replacement-attempt');
  test.vi.mocked(operations.startChatGptSignIn).mockResolvedValueOnce({
    url: 'https://auth.openai.com/test',
    attemptId: 'old-attempt'
  });
  let rejectOld!: (error: Error) => void;

  test.vi.mocked(operations.finishChatGptSignIn).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      })
  );
  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Cancel sign-in' }));
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await test.waitFor(() =>
    test.expect(operations.finishChatGptSignIn).toHaveBeenLastCalledWith('replacement-attempt')
  );
  await test.act(async () => {
    rejectOld(new Error('Cancelled'));
  });
  test
    .expect(test.screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting }))
    .toBeInTheDocument();
  test.expect(popup.close).not.toHaveBeenCalled();
});

test.stable(
  'unsupported browser origins show localized sign-in guidance and close the blank tab',
  async () => {
    const { popup } = browserWindow();

    test.vi.mocked(operations.startChatGptSignIn).mockRejectedValue({
      kind: 'unsupported',
      message: 'Loopback required',
      retryAfterMs: null
    });
    mount();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    test
      .expect(await test.screen.findByText(catalogs.english.AiSettingsSignInLocalOnly))
      .toBeInTheDocument();
    test.expect(popup.close).toHaveBeenCalled();
  }
);

test.stable('native sign-in opens the system browser without a webview popup', async () => {
  runtime.native = true;
  const { open } = browserWindow();

  pendingSignIn('native-attempt');
  const view = mount();

  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
  await test.waitFor(() =>
    test.expect(runtime.openUrl).toHaveBeenCalledWith('https://auth.openai.com/test')
  );
  test.expect(open).not.toHaveBeenCalled();
  test
    .expect(test.screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting }))
    .toBeInTheDocument();
  view.unmount();
  await test.waitFor(() =>
    test.expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('native-attempt')
  );
});

test.stable(
  'a native browser launch failure cancels its attempt instead of waiting forever',
  async () => {
    runtime.native = true;
    runtime.openUrl.mockRejectedValue(new Error('No browser'));
    pendingSignIn('native-failed-attempt');
    mount();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await test.waitFor(() =>
      test.expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('native-failed-attempt')
    );
    test
      .expect(await test.screen.findByRole('button', { name: 'Sign in to ChatGPT' }))
      .toBeEnabled();
  }
);
