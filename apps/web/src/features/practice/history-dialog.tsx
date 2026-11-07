import type { MaterialId, QuizAttemptId } from '@study/contracts/ids';
import type {
  quizAttemptSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import { questionNumber, reviewProgress } from '@study/localization';
import { Dialog, DialogTrigger } from '@study/ui/dialog';
import { NextButton, PreviousButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { Textarea } from '@study/ui/textarea';
import { WorkspaceCard } from '@study/ui/workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowUpRight, History } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AttemptState } from './attempt-state';
import { attemptOptions, attemptsOptions } from './practice.queries';
import { PracticeQueryState } from './query-state';
import { QuizResults } from './quiz-results';

type InProgress = typeof quizAttemptInProgressSchema.Type;

type Question = InProgress['questions'][number];

export function AttemptsAction({ id }: { id: MaterialId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<WorkspaceCard.Item />}>
        <History aria-hidden="true" />
        <span>{t('PracticeAttempts')}</span>
        <ArrowUpRight aria-hidden="true" />
      </DialogTrigger>
      <Surface.Popup
        contentLayout="fill"
        keepMounted
        closeLabel={t('Close')}
        bottomStickOnMobile={false}
      >
        <Surface.Title>{t('PracticeAttempts')}</Surface.Title>
        <AttemptsPanel id={id} open={open} close={() => setOpen(false)} />
      </Surface.Popup>
    </Dialog>
  );
}

function AttemptsPanel({ id, open, close }: { id: MaterialId; open: boolean; close: () => void }) {
  const { t, date } = useI18n();
  const history = useInfiniteQuery({ ...attemptsOptions(id), enabled: open });
  const [selected, select] = useState<QuizAttemptId>();
  const [search, setSearch] = useState('');
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const visible = items.filter(({ attempt }) =>
    (date(attempt.started_at) + ' ' + t(attemptStatus(attempt.status)))
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  );
  const active = visible.find(({ attempt }) => attempt.id === selected) ?? visible[0];

  return (
    <Surface.Root>
      <Surface.Navigation aria-label={t('PracticeAttempts')}>
        <Surface.SearchField
          label={t('PracticeSearchAttempts')}
          value={search}
          onValueChange={setSearch}
        />
        {visible.map(({ attempt }) => (
          <Surface.Item
            key={String(attempt.id)}
            aria-current={active?.attempt.id === attempt.id ? 'true' : undefined}
            onClick={() => select(attempt.id)}
            icon={<History aria-hidden="true" />}
            label={date(attempt.started_at)}
            description={t(attemptStatus(attempt.status))}
          />
        ))}
        {history.hasNextPage && (
          <Surface.More
            pending={history.isFetchingNextPage}
            onLoad={() => void history.fetchNextPage()}
            label={t('LibraryMore')}
          />
        )}
      </Surface.Navigation>
      <Surface.Main>
        {!active && <Surface.DetailHeader title={<>{t('PracticeAttempts')}</>} />}
        {active && !history.isError ? (
          <AttemptPreview
            key={String(active.attempt.id)}
            id={active.attempt.id}
            material={id}
            open={open}
            close={close}
          />
        ) : (
          <Surface.Scroll>
            <Surface.Body>
              <PracticeQueryState state={history}>
                <Surface.EmptyState
                  icon={<History aria-hidden="true" />}
                  title={<>{t(search ? 'SearchNoResults' : 'PracticeNoAttempts')}</>}
                  description={
                    <>{t(search ? 'PracticeAttemptSearchHelp' : 'PracticeQuizSaveHint')}</>
                  }
                />
              </PracticeQueryState>
            </Surface.Body>
          </Surface.Scroll>
        )}
      </Surface.Main>
    </Surface.Root>
  );
}

function attemptStatus(status: 'in_progress' | 'completed') {
  return status === 'completed' ? 'PracticeAttemptCompleted' : 'PracticeAttemptInProgress';
}

function AttemptPreview({
  id,
  material,
  open,
  close
}: {
  id: QuizAttemptId;
  material: MaterialId;
  open: boolean;
  close: () => void;
}) {
  const state = useQuery({ ...attemptOptions(id), enabled: open });

  return (
    <AttemptState state={state} material={material}>
      {(attempt) => <AttemptPreviewContent attempt={attempt} close={close} />}
    </AttemptState>
  );
}

function AttemptPreviewContent({
  attempt,
  close
}: {
  attempt: typeof quizAttemptSchema.Type;
  close: () => void;
}) {
  if (attempt.status === 'in_progress') return <SavedAttempt attempt={attempt} close={close} />;

  return <QuizResults attempt={attempt} presentation="preview" />;
}

function SavedAttempt({ attempt, close }: { attempt: InProgress; close: () => void }) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  const question = attempt.questions[index];
  const answered = attempt.questions.filter((item) => item.answer !== null).length;

  return (
    <>
      <Surface.Header>
        <Surface.DetailHeading>
          <h2>{t('PracticeAttempts')}</h2>
          <Practice.MutedText>
            {questionNumber(locale, index + 1)} ·{' '}
            {reviewProgress(locale, answered, attempt.questions.length)}
          </Practice.MutedText>
          <Practice.Progress
            aria-label={t('PracticeProgress')}
            value={answered}
            max={attempt.questions.length}
          />
        </Surface.DetailHeading>
      </Surface.Header>
      <Surface.ArchiveFrame>
        <Surface.Scroll>
          <Surface.Body>
            <Practice.Preview>
              {question && <SavedQuestion question={question} />}
              <Practice.Muted>{t('PracticeResumeHelp')}</Practice.Muted>
            </Practice.Preview>
          </Surface.Body>
        </Surface.Scroll>
        <Surface.ArchiveFooter>
          <Surface.ArchiveActions>
            <Practice.FooterContext>
              <PreviousButton
                variant="outline"
                disabled={index === 0}
                onClick={() => setIndex((current) => current - 1)}
                label={t('QuizPrevious')}
              ></PreviousButton>
              <NextButton
                variant="outline"
                disabled={index >= attempt.questions.length - 1}
                onClick={() => setIndex((current) => current + 1)}
                label={t('NextQuestion')}
              ></NextButton>
            </Practice.FooterContext>
            <ResumeAttempt attempt={attempt} close={close} />
          </Surface.ArchiveActions>
        </Surface.ArchiveFooter>
      </Surface.ArchiveFrame>
    </>
  );
}

function SavedQuestion({ question }: { question: Question }) {
  const { t } = useI18n();
  const label = 'history-question-' + String(question.id);
  const selected = question.answer?.type === 'choice' ? question.answer.choiceIds : [];

  return (
    <div>
      <Practice.Prompt id={label}>{question.prompt}</Practice.Prompt>
      <Practice.Muted>
        {t(question.answer ? 'PracticeAnswerRecorded' : 'PracticeUnanswered')}
      </Practice.Muted>
      <Practice.Answers aria-labelledby={label}>
        {!('choices' in question) ? (
          <Textarea
            aria-label={t('YourAnswer')}
            readOnly
            value={question.answer?.type === 'open' ? question.answer.answer : ''}
            placeholder={t('PracticeUnanswered')}
          />
        ) : (
          question.choices.map((choice, number) => (
            <Practice.ChoiceOption
              key={String(choice.id)}
              number={number + 1}
              text={
                question.kind === 'true_false'
                  ? t(choice.text === 'true' ? 'PracticeTrue' : 'PracticeFalse')
                  : choice.text
              }
              selected={selected.includes(choice.id)}
              type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
              name={label}
              value={String(choice.id)}
              readOnly
              disabled
            />
          ))
        )}
      </Practice.Answers>
    </div>
  );
}

function ResumeAttempt({ attempt, close }: { attempt: InProgress; close: () => void }) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });

  return (
    <NextButton
      render={
        <Link
          to="/practice/$materialId"
          params={{ materialId: String(attempt.materialId) }}
          search={{ project: search.project, attempt: String(attempt.id) }}
        />
      }
      onClick={close}
      label={t('PracticeResume')}
    ></NextButton>
  );
}
