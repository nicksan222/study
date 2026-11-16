import { test } from '@study/testing';

import type * as __StudyMockType1 from '#client/app/onboarding.tsx';
import type * as __StudyMockType0 from '#client/features/onboarding/index.tsx';

function createApi(mock: test.Mock) {
  return { read: mock.fn(), save: mock.fn(), signIn: mock.fn() };
}

let api: ReturnType<typeof createApi>;

let ReplayOnboarding: typeof __StudyMockType0.ReplayOnboarding;

let OnboardingProvider: typeof __StudyMockType1.OnboardingProvider;

test.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('#client/pages/settings/general/index.tsx', () => ({
    GeneralSettings: () => <div>Language control</div>
  }));
  mock('#client/pages/settings/theme-library.tsx', () => ({
    ColorScheme: () => <div>Appearance control</div>
  }));
  mock('#client/pages/settings/use-page.ts', () => ({
    useAppearance: () => ({ data: {}, error: false })
  }));
  mock('#client/pages/settings/ai/index.tsx', () => ({
    AiAccountSettings: () => <button onClick={api.signIn}>ChatGPT sign in</button>
  }));
  const __studyMockModule0 = await import('#client/features/onboarding/index.tsx');

  ReplayOnboarding = __studyMockModule0.ReplayOnboarding;
  const __studyMockModule1 = await import('./onboarding');

  OnboardingProvider = __studyMockModule1.OnboardingProvider;
});

test.afterEach(({ vi }) => {
  vi.resetAllMocks();
});

function mount(
  { rpcTestTransport, render }: Pick<test.Context, 'rpcTestTransport' | 'render'>,
  onboarded = false,
  loadError = false
) {
  if (loadError) api.read.mockRejectedValue(new Error('offline'));
  else api.read.mockResolvedValue({ onboarded, language: 1, appearance: 3, zoomPercent: 100 });

  api.save.mockResolvedValue({});
  const cache = rpcTestTransport(async (tag, input) =>
    tag === 'settings.appSettings' ? api.read() : api.save(input)
  );

  render(
    <cache.wrapper>
      <OnboardingProvider>
        <ReplayOnboarding />
      </OnboardingProvider>
    </cache.wrapper>
  );
}

test.stable(
  'shows first run, supports back, and saves completion before closing',
  async ({ screen, fireEvent, expect, waitFor, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
    await screen.findByRole('dialog');
    await screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
    fireEvent.click(screen.getByRole('button', { name: /OnboardingStart/ }));
    await screen.findByRole('heading', { name: 'GeneralSettingsLanguage' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('dialog');
    await screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
    fireEvent.click(screen.getByRole('button', { name: /OnboardingStart/ }));

    for (const title of [
      'ColorScheme',
      'OnboardingSubjectsTitle',
      'OnboardingNotesTitle',
      'OnboardingPagesTitle',
      'OnboardingWorkflowTitle',
      'OnboardingConnectTitle'
    ]) {
      fireEvent.click(screen.getByRole('button', { name: /OnboardingNext/ }));
      await screen.findByRole('heading', { name: title });
      expect(api.save).not.toHaveBeenCalled();

      if (title === 'OnboardingSubjectsTitle')
        expect(screen.getByText('OnboardingSampleSubject')).toBeInTheDocument();

      if (title === 'OnboardingPagesTitle')
        expect(
          screen.getByRole('heading', { name: 'OnboardingSamplePageTitle' })
        ).toBeInTheDocument();

      if (title === 'OnboardingWorkflowTitle') {
        fireEvent.click(screen.getByRole('button', { name: 'OnboardingPreviewTransform' }));
        expect(
          screen.getByRole('heading', { name: 'OnboardingSamplePageTitle' })
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'OnboardingPreviewNotes' }));
        expect(screen.getByText('OnboardingSampleEntry')).toBeInTheDocument();
      }
    }

    expect(screen.getByRole('button', { name: /OnboardingFinish/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT sign in' }));
    expect(api.signIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /OnboardingFinish/ }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }))
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
);
test.stable(
  'does not reopen completed onboarding until replay, which starts at welcome',
  async ({ screen, expect, fireEvent, waitFor, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render }, true);
    await screen.findByRole('button', { name: 'ReplayOnboarding' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ReplayOnboarding' }));
    await screen.findByRole('dialog');
    await screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
    fireEvent.click(screen.getByRole('button', { name: 'OnboardingSkip' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'ReplayOnboarding' }));
    await screen.findByRole('dialog');
    await screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
  }
);
test.stable(
  'retains the flow on save failure and allows retry',
  async ({ screen, fireEvent, expect, waitFor, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
    api.save.mockRejectedValueOnce(new Error('offline'));
    await screen.findByRole('dialog');
    await screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
    fireEvent.click(screen.getByRole('button', { name: 'OnboardingSkip' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OnboardingSkip' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
);

test.stable(
  'keeps first run closed when settings cannot be loaded',
  async ({ waitFor, expect, screen, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render }, false, true);
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  }
);
