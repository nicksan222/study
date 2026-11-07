import { defaultQuizSettings } from '@study/contracts/settings/types';
import type { QuizSettings } from '@study/contracts/settings/types';
import { RetryButton } from '@study/ui/action-button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';
import {
  quizSettingsOptions,
  quizSettingsMutationOptions
} from '#web/lib/study-client/quiz-settings.queries.ts';

function useQuizSettings() {
  const client = useQueryClient();
  const query = useQuery(quizSettingsOptions());
  const mutation = useMutation({
    ...quizSettingsMutationOptions(),
    onSuccess: (_, configuration) =>
      client.setQueryData(quizSettingsOptions().queryKey, configuration)
  });
  const configuration = query.data ?? defaultQuizSettings;

  return {
    configuration,
    ready: query.isSuccess && !mutation.isPending,
    loading: query.isPending,
    pending: mutation.isPending,
    error: query.isError || mutation.isError,
    update: (patch: Partial<QuizSettings>) => mutation.mutate({ ...configuration, ...patch }),
    retry: () => {
      mutation.reset();
      void query.refetch();
    }
  };
}

/** Persist quiz preferences with an explicit filter for each supported question kind. */
function QuizSettingsPanel({ model }: { model: ReturnType<typeof useQuizSettings> }) {
  const { t } = useI18n();
  const config = model.configuration;
  const disabled = model.loading || model.pending;

  return (
    <Settings.Section title={t('QuizSettingsTitle')}>
      <Settings.Intro>{t('QuizSettingsIntro')}</Settings.Intro>
      {model.loading && <Loading label={t('LoadingSettings')} layout="panel" />}
      {model.error && (
        <ErrorState
          layout="inline"
          title={t('QuizSettingsError')}
          action={
            <RetryButton variant="outline" size="sm" onClick={model.retry} label={t('Retry')} />
          }
        />
      )}
      <Settings.Group>
        <Settings.SelectRow
          title={t('QuizQuestionCount')}
          description={t('QuizQuestionCountHelp')}
          value={String(config.questionCount)}
          disabled={disabled}
          options={Array.from({ length: 10 }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1)
          }))}
          onValueChange={(value) => model.update({ questionCount: Number(value) })}
        />
        <Settings.SelectRow
          title={t('QuizQuestionKind')}
          description={t('QuizQuestionKindHelp')}
          value={config.questionKind}
          disabled={disabled}
          options={[
            { value: 'all', label: t('QuizKindAll') },
            { value: 'choice', label: t('QuestionChoice') },
            { value: 'open', label: t('QuestionOpen') },
            { value: 'fill_blank', label: t('PracticeFillBlank') },
            { value: 'matching', label: t('PracticeMatching') },
            { value: 'true_false', label: t('PracticeTrueFalse') }
          ]}
          onValueChange={(value) => {
            if (
              value === 'all' ||
              value === 'choice' ||
              value === 'open' ||
              value === 'fill_blank' ||
              value === 'matching' ||
              value === 'true_false'
            )
              model.update({ questionKind: value });
          }}
        />
        <Settings.ToggleRow
          title={t('QuizShuffleQuestions')}
          description={t('QuizShuffleQuestionsHelp')}
          checked={config.questionOrder === 'shuffle'}
          disabled={disabled}
          onCheckedChange={(checked) =>
            model.update({ questionOrder: checked ? 'shuffle' : 'source' })
          }
        />
        <Settings.ToggleRow
          title={t('QuizShuffleChoices')}
          description={t('QuizShuffleChoicesHelp')}
          checked={config.shuffleChoices}
          disabled={disabled}
          onCheckedChange={(shuffleChoices) => model.update({ shuffleChoices })}
        />
        <Settings.SelectRow
          title={t('QuizGenerateChoices')}
          description={t('QuizGenerationChoicesHelp')}
          value={String(config.choiceCount)}
          disabled={disabled}
          options={Array.from({ length: 5 }, (_, index) => ({
            value: String(index + 2),
            label: String(index + 2)
          }))}
          onValueChange={(value) => model.update({ choiceCount: Number(value) })}
        />
        <Settings.SelectRow
          title={t('QuizDifficulty')}
          description={t('QuizGenerationDifficultyHelp')}
          value={config.difficulty}
          disabled={disabled}
          options={[
            { value: 'easy', label: t('QuizDifficultyEasy') },
            { value: 'balanced', label: t('QuizDifficultyBalanced') },
            { value: 'challenging', label: t('QuizDifficultyChallenging') }
          ]}
          onValueChange={(difficulty) => {
            if (difficulty === 'easy' || difficulty === 'balanced' || difficulty === 'challenging')
              model.update({ difficulty });
          }}
        />
      </Settings.Group>
      {model.pending && <Settings.Feedback role="status">{t('Saving')}</Settings.Feedback>}
    </Settings.Section>
  );
}

export function QuizSettings() {
  return <QuizSettingsPanel model={useQuizSettings()} />;
}
