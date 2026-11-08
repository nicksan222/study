import { AgentRule, maxAgentRuleLength } from '@study/contracts/settings/schemas';
import type { AgentRuleKey } from '@study/contracts/settings/schemas';
import type { StaticMessageKey } from '@study/localization';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import { useAgentRules } from './use-agent-rules';

const tasks = {
  [AgentRule.Pages.key]: { title: 'AgentRulesPages', help: 'AgentRulesPagesHelp' },
  [AgentRule.Titles.key]: { title: 'AgentRulesTitles', help: 'AgentRulesTitlesHelp' },
  [AgentRule.Replies.key]: { title: 'AgentRulesReplies', help: 'AgentRulesRepliesHelp' },
  [AgentRule.Quizzes.key]: { title: 'AgentRulesQuizzes', help: 'AgentRulesQuizzesHelp' },
  [AgentRule.Flashcards.key]: { title: 'AgentRulesFlashcards', help: 'AgentRulesFlashcardsHelp' },
  [AgentRule.Diagrams.key]: { title: 'AgentRulesDiagrams', help: 'AgentRulesDiagramsHelp' },
  [AgentRule.Grading.key]: { title: 'AgentRulesGrading', help: 'AgentRulesGradingHelp' },
  [AgentRule.Transcription.key]: {
    title: 'AgentRulesTranscription',
    help: 'AgentRulesTranscriptionHelp'
  },
  [AgentRule.QuestionDetection.key]: {
    title: 'AgentRulesQuestionDetection',
    help: 'AgentRulesQuestionDetectionHelp'
  }
} as const satisfies Record<AgentRuleKey, { title: StaticMessageKey; help: StaticMessageKey }>;

/** Holds drafts across task changes and commits all edited preferences in one transaction. */
export function AgentRulesSettings() {
  const { t } = useI18n();
  const model = useAgentRules();
  const { query, mutation, rules, selected, changed } = model;
  const task = tasks[selected.key];
  const options = Object.values(AgentRule).map((value) => ({
    value: value.key,
    label: t(tasks[value.key].title)
  }));

  return (
    <Settings.Section title={t('AgentRulesTitle')}>
      <Settings.Intro>{t('AgentRulesIntro')}</Settings.Intro>
      {query.isPending && <Loading label={t('LoadingSettings')} layout="panel" />}
      {query.isError && (
        <Settings.Status
          action={
            <RetryButton
              variant="outline"
              size="sm"
              label={t('Retry')}
              onClick={() => void query.refetch()}
            />
          }
        >
          {t('AgentRulesLoadFailed')}
        </Settings.Status>
      )}
      {mutation.isError && <Settings.Status>{t('AgentRulesSaveFailed')}</Settings.Status>}
      {rules && (
        <>
          <Settings.Group>
            <Settings.SelectRow
              title={t('AgentRulesTask')}
              value={selected.key}
              options={options}
              disabled={mutation.isPending}
              onValueChange={model.select}
            />
            <Settings.TextareaRow
              title={t(task.title)}
              description={t(task.help)}
              placeholder={t('AgentRulesPlaceholder')}
              value={rules[selected.key]}
              maxLength={maxAgentRuleLength}
              disabled={mutation.isPending}
              onChange={(event) => model.update(event.target.value)}
            />
          </Settings.Group>
          <Settings.Actions>
            <Button
              variant="ghost"
              disabled={mutation.isPending || !rules[selected.key]}
              onClick={() => model.update('')}
            >
              {t('AgentRulesUseDefault')}
            </Button>
            <Button
              disabled={mutation.isPending || !changed}
              onClick={() => mutation.mutate(rules)}
            >
              {t(mutation.isPending ? 'Saving' : 'Save')}
            </Button>
          </Settings.Actions>
          {mutation.isSuccess && !changed && (
            <Settings.Feedback role="status">{t('AgentRulesSaved')}</Settings.Feedback>
          )}
        </>
      )}
    </Settings.Section>
  );
}
