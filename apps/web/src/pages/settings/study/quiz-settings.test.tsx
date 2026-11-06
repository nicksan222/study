import { defaultQuizSettings } from '@study/contracts/settings/types';
import type { QuizSettings as QuizPreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { QuizSettings } from './quiz-settings';

const api = vi.hoisted(() => ({
  read: vi.fn<() => Promise<QuizPreferences>>(),
  save: vi.fn<(value: QuizPreferences) => Promise<QuizPreferences>>()
}));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (
    invoke: (rpc: {
      'settings.quizSettings': typeof api.read;
      'settings.saveQuizSettings': typeof api.save;
    }) => unknown
  ) => invoke({ 'settings.quizSettings': api.read, 'settings.saveQuizSettings': api.save })
}));

const clients: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(defaultQuizSettings);
  api.save.mockImplementation(async (value) => value);
});
afterEach(() => {
  for (const client of clients) client.clear();

  clients.length = 0;
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <QuizSettings />
    </QueryClientProvider>
  );
}

testStable('persists quiz order while preserving count, type, and answer settings', async () => {
  mount();
  const control = await screen.findByRole('switch', { name: 'QuizShuffleQuestions' });

  await waitFor(() => expect(control).toBeEnabled());
  fireEvent.click(control);
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledExactlyOnceWith({
      ...defaultQuizSettings,
      questionOrder: 'shuffle'
    })
  );
  await waitFor(() => expect(control).toBeChecked());
  fireEvent.click(screen.getByRole('switch', { name: 'QuizShuffleChoices' }));
  await waitFor(() =>
    expect(api.save).toHaveBeenLastCalledWith({
      ...defaultQuizSettings,
      questionOrder: 'shuffle',
      shuffleChoices: false
    })
  );
});

testStable('retains confirmed settings when saving fails and provides recovery', async () => {
  api.save.mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  const control = await screen.findByRole('switch', { name: 'QuizShuffleChoices' });

  await waitFor(() => expect(control).toBeEnabled());
  fireEvent.click(control);
  expect(await screen.findByText('QuizSettingsError')).toBeInTheDocument();
  expect(control).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByText('QuizSettingsError')).toBeNull());
});

testStable('persists new quiz choice count and difficulty in study settings', async () => {
  mount();
  const user = userEvent.setup();
  const choices = await screen.findByRole('combobox', { name: 'QuizGenerateChoices' });

  await waitFor(() => expect(choices).toBeEnabled());
  await user.click(choices);
  await user.click(await screen.findByRole('option', { name: /^6$/ }));
  await waitFor(() =>
    expect(api.save).toHaveBeenLastCalledWith({ ...defaultQuizSettings, choiceCount: 6 })
  );
  await user.click(screen.getByRole('combobox', { name: 'QuizDifficulty' }));
  await user.click(await screen.findByRole('option', { name: 'QuizDifficultyChallenging' }));
  await waitFor(() =>
    expect(api.save).toHaveBeenLastCalledWith({
      ...defaultQuizSettings,
      choiceCount: 6,
      difficulty: 'challenging'
    })
  );
});
