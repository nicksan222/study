import { llmSettingsSchema, apiKeyInputSchema } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as Host from '#client/lib/host.ts';
import type * as __StudyMockType0 from '#client/pages/settings/ai/index.tsx';

function createRuntime(mock: test.Mock) {
  return { native: false, openUrl: mock.fn() };
}

let runtime: ReturnType<typeof createRuntime>;

function createOperations(mock: test.Mock) {
  return {
    loadAiSettings: mock.fn(),
    startChatGptSignIn: mock.fn(),
    finishChatGptSignIn: mock.fn(),
    cancelChatGptSignIn: mock.fn(),
    signOutChatGpt: mock.fn(),
    saveAiSettings: mock.fn(),
    saveProviderApiKey: mock.fn()
  };
}

let operations: ReturnType<typeof createOperations>;

let AiAccountSettings: typeof __StudyMockType0.AiAccountSettings;

let AiModelSettings: typeof __StudyMockType0.AiModelSettings;

test.unit.beforeEach(async ({ mock }) => {
  runtime = createRuntime(mock);
  operations = createOperations(mock);
  mock('#client/lib/host.ts', async (importOriginal) => {
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
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => createLocalization('english')
  }));
  const __studyMockModule0 = await import('./index');

  AiAccountSettings = __studyMockModule0.AiAccountSettings;
  AiModelSettings = __studyMockModule0.AiModelSettings;
});

test.unit.beforeEach(() => {
  runtime.native = false;
  runtime.openUrl.mockReset().mockResolvedValue(undefined);
});

const settings = {
  tiny: { provider: 1, model: 1 },
  medium: { provider: 1, model: 2 },
  smart: { provider: 1, model: 3 }
} as const;

function mount(
  { vi, rpcTestTransport, render }: Pick<test.unit.Context, 'vi' | 'rpcTestTransport' | 'render'>,
  Section = AiAccountSettings
) {
  vi.mocked(operations.loadAiSettings).mockResolvedValue({
    settings,
    providers: [],
    status: { signedIn: Section === AiModelSettings, email: null, sharing: false }
  });
  const fixture = rpcTestTransport(async (tag, input) => {
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

  return render(<Section />, { wrapper: fixture.wrapper });
}

test.unit.stable(
  'saves a canonical model change while preserving the other tiers',
  async ({ vi, userEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    vi.mocked(operations.saveAiSettings).mockResolvedValue({});
    mount({ vi, rpcTestTransport, render }, AiModelSettings);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('combobox', { name: catalogs.english.AiSettingsMedium })
    );
    await user.click(await screen.findByRole('option', { name: 'ChatGPT — GPT-6 Astra' }));
    await waitFor(() =>
      expect(operations.saveAiSettings).toHaveBeenCalledWith({
        ...settings,
        medium: { provider: 1, model: 3 }
      })
    );
    expect(operations.startChatGptSignIn).not.toHaveBeenCalled();
  }
);

function browserWindow({ vi }: Pick<test.unit.Context, 'vi'>) {
  const popup = {
    location: { replace: vi.fn() },
    close: vi.fn(),
    closed: false,
    opener: window
  };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

  return { popup, open };
}

function pendingSignIn({ vi }: Pick<test.unit.Context, 'vi'>, attemptId: string) {
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

test.unit.stable(
  'opens ChatGPT immediately and waits automatically with only a spinner',
  async ({ fireEvent, screen, expect, waitFor, vi, rpcTestTransport, render }) => {
    const { popup, open } = browserWindow({ vi });

    pendingSignIn({ vi }, 'owned-attempt');
    const view = mount({ vi, rpcTestTransport, render });

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() =>
      expect(popup.location.replace).toHaveBeenCalledWith('https://auth.openai.com/test')
    );
    await waitFor(() =>
      expect(operations.finishChatGptSignIn).toHaveBeenCalledWith('owned-attempt')
    );
    expect(
      screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting }).tagName.toLowerCase()
    ).toBe('svg');
    expect(screen.queryByRole('link', { name: 'Open ChatGPT sign-in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I completed sign-in' })).not.toBeInTheDocument();
    expect(screen.queryByText(catalogs.english.AiSettingsWaiting)).not.toBeInTheDocument();
    view.unmount();
    await waitFor(() =>
      expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('owned-attempt')
    );
    expect(popup.close).toHaveBeenCalled();
  }
);

test.unit.stable(
  'offers a recovery link when the browser blocks the sign-in tab',
  async ({ vi, fireEvent, screen, expect, waitFor, rpcTestTransport, render }) => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    pendingSignIn({ vi }, 'blocked-attempt');
    mount({ vi, rpcTestTransport, render });
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
  }
);

test.unit.stable(
  'closes the sign-in tab when starting authorization fails',
  async ({ vi, fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    const { popup } = browserWindow({ vi });

    vi.mocked(operations.startChatGptSignIn).mockRejectedValue(new Error('Unavailable'));
    mount({ vi, rpcTestTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
  }
);

test.unit.stable(
  'finishes automatically, refreshes the account, and closes the browser tab',
  async ({ vi, fireEvent, screen, expect, rpcTestTransport, render }) => {
    const { popup } = browserWindow({ vi });

    pendingSignIn({ vi }, 'completed-attempt');
    vi.mocked(operations.finishChatGptSignIn).mockImplementation(async () => {
      vi.mocked(operations.loadAiSettings).mockResolvedValue({
        settings,
        providers: [],
        status: { signedIn: true, email: 'learner@example.com', sharing: true }
      });

      return { signedIn: true, email: 'learner@example.com', sharing: true };
    });
    mount({ vi, rpcTestTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(screen.getByText('learner@example.com')).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  }
);

test.unit.stable(
  'a failed sign-in clears the spinner and allows another attempt',
  async ({ vi, fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    const { popup } = browserWindow({ vi });

    pendingSignIn({ vi }, 'failed-attempt');
    vi.mocked(operations.finishChatGptSignIn).mockRejectedValue(new Error('Declined'));
    mount({ vi, rpcTestTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
    expect(
      screen.queryByRole('status', { name: catalogs.english.AiSettingsWaiting })
    ).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'a cancelled completion cannot clear or close its replacement sign-in',
  async ({ vi, fireEvent, screen, waitFor, expect, act, rpcTestTransport, render }) => {
    const { popup, open } = browserWindow({ vi });

    open.mockReturnValueOnce(null);
    pendingSignIn({ vi }, 'replacement-attempt');
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
    mount({ vi, rpcTestTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await waitFor(() =>
      expect(operations.finishChatGptSignIn).toHaveBeenLastCalledWith('replacement-attempt')
    );
    await act(async () => {
      rejectOld(new Error('Cancelled'));
    });
    expect(
      screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting })
    ).toBeInTheDocument();
    expect(popup.close).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'unsupported browser origins show localized sign-in guidance and close the blank tab',
  async ({ vi, fireEvent, screen, expect, rpcTestTransport, render }) => {
    const { popup } = browserWindow({ vi });

    vi.mocked(operations.startChatGptSignIn).mockRejectedValue({
      kind: 'unsupported',
      message: 'Loopback required',
      retryAfterMs: null
    });
    mount({ vi, rpcTestTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    expect(await screen.findByText(catalogs.english.AiSettingsSignInLocalOnly)).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  }
);

test.unit.stable(
  'native sign-in opens the system browser without a webview popup',
  async ({ fireEvent, screen, waitFor, expect, vi, rpcTestTransport, render }) => {
    runtime.native = true;
    const { open } = browserWindow({ vi });

    pendingSignIn({ vi }, 'native-attempt');
    const view = mount({ vi, rpcTestTransport, render });

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await waitFor(() =>
      expect(runtime.openUrl).toHaveBeenCalledWith('https://auth.openai.com/test')
    );
    expect(open).not.toHaveBeenCalled();
    expect(
      screen.getByRole('status', { name: catalogs.english.AiSettingsWaiting })
    ).toBeInTheDocument();
    view.unmount();
    await waitFor(() =>
      expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('native-attempt')
    );
  }
);

test.unit.stable(
  'a native browser launch failure cancels its attempt instead of waiting forever',
  async ({ fireEvent, screen, waitFor, expect, vi, rpcTestTransport, render }) => {
    runtime.native = true;
    runtime.openUrl.mockRejectedValue(new Error('No browser'));
    pendingSignIn({ vi }, 'native-failed-attempt');
    mount({ vi, rpcTestTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ChatGPT' }));
    await waitFor(() =>
      expect(operations.cancelChatGptSignIn).toHaveBeenCalledWith('native-failed-attempt')
    );
    expect(await screen.findByRole('button', { name: 'Sign in to ChatGPT' })).toBeEnabled();
  }
);
