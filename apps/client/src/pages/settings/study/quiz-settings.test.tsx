import { quizSettingsSchema, defaultQuizSettings } from '@study/contracts';
import type { QuizSettings as QuizPreferences } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __StudyMockType0 from '#client/pages/settings/study/quiz-settings.tsx';

let QuizSettings: typeof __StudyMockType0.QuizSettings;

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __studyMockModule0 = await import('./quiz-settings');

  QuizSettings = __studyMockModule0.QuizSettings;
});

function mount(kind?: 'matching') {
  const api = {
    read: test.vi.fn(async (): Promise<QuizPreferences> => defaultQuizSettings),
    save: test.vi.fn(async (value: QuizPreferences) => value)
  };

  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.quizSettings') return api.read();

    if (tag === 'settings.saveQuizSettings') {
      const value = Schema.decodeUnknownSync(quizSettingsSchema)(input);

      await api.save(value);

      api.read.mockResolvedValue(value);
      await fixture.notify();

      return {};
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  test.render(<QuizSettings kind={kind} />, { wrapper: fixture.wrapper });

  return { ...fixture, api };
}

test.stable('persists quiz order while preserving count, type, and answer settings', async () => {
  const { api } = mount();
  const control = await test.screen.findByRole('switch', { name: 'QuizShuffleQuestions' });

  await test.waitFor(() => test.expect(control).toBeEnabled());
  test.fireEvent.click(control);
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenCalledExactlyOnceWith({
      ...defaultQuizSettings,
      questionOrder: 'shuffle'
    })
  );
  await test.waitFor(() => {
    test.expect(control).toBeChecked();
    test.expect(control).toBeEnabled();
  });
  test.fireEvent.click(test.screen.getByRole('switch', { name: 'QuizShuffleChoices' }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenLastCalledWith({
      ...defaultQuizSettings,
      questionOrder: 'shuffle',
      shuffleChoices: false
    })
  );
  await test.waitFor(() => {
    test.expect(test.screen.getByRole('switch', { name: 'QuizShuffleChoices' })).not.toBeChecked();
    test.expect(test.screen.getByRole('switch', { name: 'QuizShuffleChoices' })).toBeEnabled();
  });
});

test.stable('retains confirmed settings when saving fails and provides recovery', async () => {
  const { api } = mount();

  api.save.mockRejectedValueOnce(new Error('Unavailable'));
  const control = await test.screen.findByRole('switch', { name: 'QuizShuffleChoices' });

  await test.waitFor(() => test.expect(control).toBeEnabled());
  test.fireEvent.click(control);
  test.expect(await test.screen.findByText('QuizSettingsError')).toBeInTheDocument();
  test.expect(control).toBeChecked();
  api.read.mockResolvedValue({ ...defaultQuizSettings, choiceCount: 6 });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
  await test.waitFor(() => {
    test.expect(test.screen.queryByText('QuizSettingsError')).toBeNull();
    test
      .expect(test.screen.getByRole('combobox', { name: 'QuizGenerateChoices' }))
      .toHaveTextContent('6');
    test.expect(control).toBeEnabled();
    test.expect(control).toBeChecked();
  });
});

test.stable('persists new quiz choice count and difficulty in study settings', async () => {
  const { api } = mount();
  const user = test.userEvent.setup();
  const refreshed = Promise.withResolvers<QuizPreferences>();
  const choices = await test.screen.findByRole('combobox', { name: 'QuizGenerateChoices' });

  await test.waitFor(() => test.expect(choices).toBeEnabled());
  api.read.mockImplementationOnce(() => refreshed.promise);
  await user.click(choices);
  await user.click(await test.screen.findByRole('option', { name: /^6$/ }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenLastCalledWith({ ...defaultQuizSettings, choiceCount: 6 })
  );
  await test.waitFor(() => test.expect(choices).toBeDisabled());
  refreshed.resolve({ ...defaultQuizSettings, choiceCount: 6 });
  const difficulty = test.screen.getByRole('combobox', { name: 'QuizDifficulty' });

  await test.waitFor(() => {
    test.expect(choices).toHaveTextContent('6');
    test.expect(choices).toBeEnabled();
    test.expect(difficulty).toBeEnabled();
  });
  await user.click(difficulty);
  await user.click(await test.screen.findByRole('option', { name: 'QuizDifficultyChallenging' }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenLastCalledWith({
      ...defaultQuizSettings,
      choiceCount: 6,
      difficulty: 'challenging'
    })
  );
  await test.waitFor(() => {
    test.expect(difficulty).toHaveTextContent('QuizDifficultyChallenging');
    test.expect(difficulty).toBeEnabled();
  });
});

test.stable('saves matching defaults independently of quiz defaults', async () => {
  const { api } = mount('matching');
  const difficulty = await test.screen.findByRole('combobox', { name: 'QuizDifficulty' });

  await test.waitFor(() => test.expect(difficulty).toBeEnabled());
  const user = test.userEvent.setup();

  await user.click(difficulty);
  await user.click(await test.screen.findByRole('option', { name: 'QuizDifficultyChallenging' }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenCalledWith({
      ...defaultQuizSettings,
      practice: { matching: { questionCount: 10, difficulty: 'challenging' } }
    })
  );
  await test.waitFor(() => {
    test.expect(difficulty).toHaveTextContent('QuizDifficultyChallenging');
    test.expect(difficulty).toBeEnabled();
  });
  test
    .expect(test.screen.queryByRole('combobox', { name: 'QuizQuestionKind' }))
    .not.toBeInTheDocument();
  test
    .expect(test.screen.queryByRole('combobox', { name: 'QuizGenerateChoices' }))
    .not.toBeInTheDocument();
});
