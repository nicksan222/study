import { AgentRule, maxAgentRuleLength } from '@study/contracts';
import type { AgentRuleKey } from '@study/contracts';
import type { StaticMessageKey } from '@study/localization';
import { RetryButton, Button, Loading, Settings } from '@study/ui';
import { useRef } from 'react';

import { DictationButton } from '#client/features/voice/index.ts';
import { useTextDictation } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { useAgentRules } from './use-agent-rules';

const tasks = {
  [AgentRule.Pages.key]: { title: 'AgentRulesPages', help: 'AgentRulesPagesHelp' },
  [AgentRule.Titles.key]: { title: 'AgentRulesTitles', help: 'AgentRulesTitlesHelp' },
  [AgentRule.Replies.key]: { title: 'AgentRulesReplies', help: 'AgentRulesRepliesHelp' },
  [AgentRule.Quizzes.key]: { title: 'AgentRulesQuizzes', help: 'AgentRulesQuizzesHelp' },
  [AgentRule.Flashcards.key]: { title: 'AgentRulesFlashcards', help: 'AgentRulesFlashcardsHelp' },
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

function AgentRulesIntro({ studyNotes }: { studyNotes: boolean }) {
  const { t } = useI18n();

  return studyNotes ? null : <Settings.Intro>{t('AgentRulesIntro')}</Settings.Intro>;
}

/** Keeps task instructions editable while their changes are persisted. */
export function AgentRulesSettings({ studyNotes = false }: { studyNotes?: boolean }) {
  const { t } = useI18n();
  const locked = studyNotes ? AgentRule.Pages : undefined;
  const model = useAgentRules(locked);
  const { query, mutation, rules, selected } = model;
  const task = tasks[selected.key];
  const input = useRef<HTMLTextAreaElement>(null);
  const dictation = useTextDictation({
    value: rules?.[selected.key] ?? '',
    onChange: model.update,
    input,
    maxLength: maxAgentRuleLength
  });
  const options = Object.values(AgentRule).map((value) => ({
    value: value.key,
    label: t(tasks[value.key].title)
  }));

  return (
    <Settings.Section
      title={t(studyNotes ? 'PracticeStudyNotesTitle' : 'AgentRulesTitle')}
      busy={mutation.isPending}
    >
      <AgentRulesIntro studyNotes={studyNotes} />
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
      {mutation.isError && (
        <Settings.Status action={<RetryButton label={t('Retry')} onClick={model.retry} />}>
          {t('AgentRulesSaveFailed')}
        </Settings.Status>
      )}
      {rules && (
        <>
          <Settings.Group>
            {!studyNotes && (
              <Settings.SelectRow
                title={t('AgentRulesTask')}
                value={selected.key}
                options={options}
                onValueChange={model.select}
              />
            )}
            <Settings.TextareaRow
              ref={input}
              action={<DictationButton targetKey={selected.key} {...dictation} />}
              title={t(task.title)}
              description={t(task.help)}
              placeholder={t('AgentRulesPlaceholder')}
              value={rules[selected.key]}
              maxLength={maxAgentRuleLength}
              onChange={(event) => model.update(event.target.value)}
            />
          </Settings.Group>
          <Settings.Actions>
            <Button
              variant="ghost"
              disabled={!rules[selected.key]}
              onClick={() => model.update('')}
            >
              {t('AgentRulesUseDefault')}
            </Button>
          </Settings.Actions>
        </>
      )}
    </Settings.Section>
  );
}
