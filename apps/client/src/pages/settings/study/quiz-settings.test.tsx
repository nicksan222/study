import { quizSettingsSchema, defaultQuizSettings } from '@study/contracts';
import type { QuizSettings as QuizPreferences } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __StudyMockType0 from '#client/pages/settings/study/quiz-settings.tsx';

let QuizSettings: typeof __StudyMockType0.QuizSettings;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __studyMockModule0 = await import('./quiz-settings');

  QuizSettings = __studyMockModule0.QuizSettings;
});

function mount(
  { vi, rpcTestTransport, render }: Pick<test.unit.Context, 'vi' | 'rpcTestTransport' | 'render'>,
  kind?: 'matching'
) {
  const api = {
    read: vi.fn(async (): Promise<QuizPreferences> => defaultQuizSettings),
    save: vi.fn(async (value: QuizPreferences) => value)
  };

  const fixture = rpcTestTransport(async (tag, input) => {
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

  render(<QuizSettings kind={kind} />, { wrapper: fixture.wrapper });

  return { ...fixture, api };
}

test.unit.stable(
  'persists quiz order while preserving count, type, and answer settings',
  async ({ screen, waitFor, expect, fireEvent, vi, rpcTestTransport, render }) => {
    const { api } = mount({ vi, rpcTestTransport, render });
    const control = await screen.findByRole('switch', { name: 'QuizShuffleQuestions' });

    await waitFor(() => expect(control).toBeEnabled());
    fireEvent.click(control);
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledExactlyOnceWith({
        ...defaultQuizSettings,
        questionOrder: 'shuffle'
      })
    );
    await waitFor(() => {
      expect(control).toBeChecked();
      expect(control).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('switch', { name: 'QuizShuffleChoices' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenLastCalledWith({
        ...defaultQuizSettings,
        questionOrder: 'shuffle',
        shuffleChoices: false
      })
    );
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'QuizShuffleChoices' })).not.toBeChecked();
      expect(screen.getByRole('switch', { name: 'QuizShuffleChoices' })).toBeEnabled();
    });
  }
);

test.unit.stable(
  'retains confirmed settings when saving fails and provides recovery',
  async ({ screen, waitFor, expect, fireEvent, vi, rpcTestTransport, render }) => {
    const { api } = mount({ vi, rpcTestTransport, render });

    api.save.mockRejectedValueOnce(new Error('Unavailable'));
    const control = await screen.findByRole('switch', { name: 'QuizShuffleChoices' });

    await waitFor(() => expect(control).toBeEnabled());
    fireEvent.click(control);
    expect(await screen.findByText('QuizSettingsError')).toBeInTheDocument();
    expect(control).toBeChecked();
    api.read.mockResolvedValue({ ...defaultQuizSettings, choiceCount: 6 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByText('QuizSettingsError')).toBeNull();
      expect(screen.getByRole('combobox', { name: 'QuizGenerateChoices' })).toHaveTextContent('6');
      expect(control).toBeEnabled();
      expect(control).toBeChecked();
    });
  }
);

test.unit.stable(
  'persists new quiz choice count and difficulty in study settings',
  async ({ userEvent, screen, waitFor, expect, vi, rpcTestTransport, render }) => {
    const { api } = mount({ vi, rpcTestTransport, render });
    const user = userEvent.setup();
    const refreshed = Promise.withResolvers<QuizPreferences>();
    const choices = await screen.findByRole('combobox', { name: 'QuizGenerateChoices' });

    await waitFor(() => expect(choices).toBeEnabled());
    api.read.mockImplementationOnce(() => refreshed.promise);
    await user.click(choices);
    await user.click(await screen.findByRole('option', { name: /^6$/ }));
    await waitFor(() =>
      expect(api.save).toHaveBeenLastCalledWith({ ...defaultQuizSettings, choiceCount: 6 })
    );
    await waitFor(() => expect(choices).toBeDisabled());
    refreshed.resolve({ ...defaultQuizSettings, choiceCount: 6 });
    const difficulty = screen.getByRole('combobox', { name: 'QuizDifficulty' });

    await waitFor(() => {
      expect(choices).toHaveTextContent('6');
      expect(choices).toBeEnabled();
      expect(difficulty).toBeEnabled();
    });
    await user.click(difficulty);
    await user.click(await screen.findByRole('option', { name: 'QuizDifficultyChallenging' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenLastCalledWith({
        ...defaultQuizSettings,
        choiceCount: 6,
        difficulty: 'challenging'
      })
    );
    await waitFor(() => {
      expect(difficulty).toHaveTextContent('QuizDifficultyChallenging');
      expect(difficulty).toBeEnabled();
    });
  }
);

test.unit.stable(
  'saves matching defaults independently of quiz defaults',
  async ({ screen, waitFor, expect, userEvent, vi, rpcTestTransport, render }) => {
    const { api } = mount({ vi, rpcTestTransport, render }, 'matching');
    const difficulty = await screen.findByRole('combobox', { name: 'QuizDifficulty' });

    await waitFor(() => expect(difficulty).toBeEnabled());
    const user = userEvent.setup();

    await user.click(difficulty);
    await user.click(await screen.findByRole('option', { name: 'QuizDifficultyChallenging' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        ...defaultQuizSettings,
        practice: { matching: { questionCount: 10, difficulty: 'challenging' } }
      })
    );
    await waitFor(() => {
      expect(difficulty).toHaveTextContent('QuizDifficultyChallenging');
      expect(difficulty).toBeEnabled();
    });
    expect(screen.queryByRole('combobox', { name: 'QuizQuestionKind' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'QuizGenerateChoices' })).not.toBeInTheDocument();
  }
);
