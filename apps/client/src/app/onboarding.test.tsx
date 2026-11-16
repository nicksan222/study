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

test.afterEach(() => {
  test.vi.resetAllMocks();
});

function mount(onboarded = false, loadError = false) {
  if (loadError) api.read.mockRejectedValue(new Error('offline'));
  else api.read.mockResolvedValue({ onboarded, language: 1, appearance: 3, zoomPercent: 100 });

  api.save.mockResolvedValue({});
  const cache = test.rpcTestTransport(async (tag, input) =>
    tag === 'settings.appSettings' ? api.read() : api.save(input)
  );

  test.render(
    <cache.wrapper>
      <OnboardingProvider>
        <ReplayOnboarding />
      </OnboardingProvider>
    </cache.wrapper>
  );
}

test.stable('shows first run, supports back, and saves completion before closing', async () => {
  mount();
  await test.screen.findByRole('dialog');
  await test.screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
  test.fireEvent.click(test.screen.getByRole('button', { name: /OnboardingStart/ }));
  await test.screen.findByRole('heading', { name: 'GeneralSettingsLanguage' });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Back' }));
  await test.screen.findByRole('dialog');
  await test.screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
  test.fireEvent.click(test.screen.getByRole('button', { name: /OnboardingStart/ }));

  for (const title of [
    'ColorScheme',
    'OnboardingSubjectsTitle',
    'OnboardingNotesTitle',
    'OnboardingPagesTitle',
    'OnboardingWorkflowTitle',
    'OnboardingConnectTitle'
  ]) {
    test.fireEvent.click(test.screen.getByRole('button', { name: /OnboardingNext/ }));
    await test.screen.findByRole('heading', { name: title });
    test.expect(api.save).not.toHaveBeenCalled();

    if (title === 'OnboardingSubjectsTitle')
      test.expect(test.screen.getByText('OnboardingSampleSubject')).toBeInTheDocument();

    if (title === 'OnboardingPagesTitle')
      test
        .expect(test.screen.getByRole('heading', { name: 'OnboardingSamplePageTitle' }))
        .toBeInTheDocument();

    if (title === 'OnboardingWorkflowTitle') {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'OnboardingPreviewTransform' }));
      test
        .expect(test.screen.getByRole('heading', { name: 'OnboardingSamplePageTitle' }))
        .toBeInTheDocument();
      test.fireEvent.click(test.screen.getByRole('button', { name: 'OnboardingPreviewNotes' }));
      test.expect(test.screen.getByText('OnboardingSampleEntry')).toBeInTheDocument();
    }
  }

  test.expect(test.screen.getByRole('button', { name: /OnboardingFinish/ })).toBeEnabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'ChatGPT sign in' }));
  test.expect(api.signIn).toHaveBeenCalledOnce();
  test.fireEvent.click(test.screen.getByRole('button', { name: /OnboardingFinish/ }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenCalledWith(test.expect.objectContaining({ onboarded: true }))
  );
  await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).toBeNull());
});
test.stable(
  'does not reopen completed onboarding until replay, which starts at welcome',
  async () => {
    mount(true);
    await test.screen.findByRole('button', { name: 'ReplayOnboarding' });
    test.expect(test.screen.queryByRole('dialog')).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'ReplayOnboarding' }));
    await test.screen.findByRole('dialog');
    await test.screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'OnboardingSkip' }));
    await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).toBeNull());
    test.fireEvent.click(test.screen.getByRole('button', { name: 'ReplayOnboarding' }));
    await test.screen.findByRole('dialog');
    await test.screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
  }
);
test.stable('retains the flow on save failure and allows retry', async () => {
  mount();
  api.save.mockRejectedValueOnce(new Error('offline'));
  await test.screen.findByRole('dialog');
  await test.screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'OnboardingSkip' }));
  await test.screen.findByRole('alert');
  test.expect(test.screen.getByRole('dialog')).toBeInTheDocument();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'OnboardingSkip' }));
  await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).toBeNull());
});

test.stable('keeps first run closed when settings cannot be loaded', async () => {
  mount(false, true);
  await test.waitFor(() => test.expect(api.read).toHaveBeenCalled());
  test.expect(test.screen.queryByRole('dialog')).toBeNull();
});
