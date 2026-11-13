import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { ReplayOnboarding } from '#client/features/onboarding/index.tsx';

import { OnboardingProvider } from './onboarding';

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), signIn: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#client/lib/study-client/preferences.ts', () => ({ loadAppSettings: api.read }));
vi.mock('#client/lib/study-client/operations.ts', () => ({ updateAppSettings: api.save }));
vi.mock('#client/pages/settings/general/index.tsx', () => ({
  GeneralSettings: () => <div>Language control</div>
}));
vi.mock('#client/pages/settings/theme-library.tsx', () => ({
  ColorScheme: () => <div>Appearance control</div>
}));
vi.mock('#client/pages/settings/use-page.ts', () => ({
  useAppearance: () => ({ data: {}, error: false })
}));
vi.mock('#client/pages/settings/ai/index.tsx', () => ({
  AiAccountSettings: () => <button onClick={api.signIn}>ChatGPT sign in</button>
}));

const caches: QueryClient[] = [];

afterEach(() => {
  caches.splice(0).forEach((cache) => cache.clear());
  vi.resetAllMocks();
});

function mount(onboarded = false, loadError = false) {
  if (loadError) api.read.mockRejectedValue(new Error('offline'));
  else api.read.mockResolvedValue({ onboarded });

  api.save.mockResolvedValue({});
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <OnboardingProvider>
        <ReplayOnboarding />
      </OnboardingProvider>
    </QueryClientProvider>
  );
}

testStable('shows first run, supports back, and saves completion before closing', async () => {
  mount();
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
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ onboarded: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
testStable(
  'does not reopen completed onboarding until replay, which starts at welcome',
  async () => {
    mount(true);
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
testStable('retains the flow on save failure and allows retry', async () => {
  mount();
  api.save.mockRejectedValueOnce(new Error('offline'));
  await screen.findByRole('dialog');
  await screen.findByRole('heading', { name: 'OnboardingWelcomeTitle' });
  fireEvent.click(screen.getByRole('button', { name: 'OnboardingSkip' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'OnboardingSkip' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

testStable('keeps first run closed when settings cannot be loaded', async () => {
  mount(false, true);
  await waitFor(() => expect(api.read).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).toBeNull();
});
