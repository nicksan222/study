import { quizAttemptIdSchema, defaultQuizSettings } from '@study/contracts';
import type {
  ProjectId,
  answerQuestionInputSchema,
  quizAttemptInProgressSchema,
  MaterialVersionDetailDto
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { StartIcon, GradeIcon } from '@study/icons';
import { questionNumber, reviewProgress, questionCount } from '@study/localization';
import { Button, ErrorState, NextButton, Practice } from '@study/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useNativeAction } from '#client/lib/effect/native.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { AttemptState } from './attempt-state';
import { QuizGenerationAction } from './quiz-generation';
import { QuizQuestion } from './quiz-question';
import { QuizResults } from './quiz-results';

type QuizSetupProps = { version: MaterialVersionDetailDto; projectId?: ProjectId; title?: string };

export function Quiz({ version, projectId, title }: QuizSetupProps) {
  const search = useSearch({ from: '__root__' });

  if (search.attempt)
    return (
      <QuizAttempt
        key={search.attempt}
        id={Schema.decodeUnknownSync(quizAttemptIdSchema)(BigInt(search.attempt))}
        material={version.material_id}
      />
    );

  return <QuizStart version={version} projectId={projectId} title={title} />;
}

/** Counts questions matching saved preferences and starts an attempt against the selected immutable version. */
function QuizStart({ version, projectId, title }: QuizSetupProps) {
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const preferences = rpc.settings.quizSettings.useQuery({});
  const configuration = preferences.data ?? defaultQuizSettings;
  const start = useNativeAction(async () => {
    const attempt = await rpc.learning.startQuiz.call({ versionId: version.id, configuration });

    await navigate({
      to: '/practice/$materialId',
      params: { materialId: String(version.material_id) },
      search: { ...search, attempt: String(attempt.id) }
    });
  });

  const available =
    version.content.kind === 'quiz'
      ? version.content.questions.filter(
          (question) =>
            configuration.questionKind === 'all' ||
            (configuration.questionKind === 'choice'
              ? question.kind === 'single_choice' || question.kind === 'multiple_choice'
              : question.kind === configuration.questionKind)
        ).length
      : 0;
  const count = Math.min(available, configuration.questionCount);

  return (
    <Practice.Stage>
      <Practice.StageBody>
        <Practice.Intro>
          <h2>{t('PracticeQuizOverview')}</h2>
          <p>{t('PracticeQuizIntro')}</p>
          <Practice.SetupActions>
            <QuizGenerationAction version={version} projectId={projectId} title={title} />
          </Practice.SetupActions>
          {count === 0 && (
            <Practice.Muted role="status">{t('QuizNoMatchingQuestions')}</Practice.Muted>
          )}
          <QuizOutline version={version} />
          <Practice.Muted>
            <GradeIcon aria-hidden="true" />
            {t('PracticeQuizSaveHint')}
          </Practice.Muted>
          {preferences.isError && <OperationError retry={() => void preferences.refetch()} />}
          {start.isError && <OperationError retry={() => start.mutate(undefined)} />}
        </Practice.Intro>
      </Practice.StageBody>
      <Practice.StageFooter>
        <Practice.FooterContext>
          <Practice.MutedText>{questionCount(locale, count)}</Practice.MutedText>
        </Practice.FooterContext>
        <Button
          disabled={start.isPending || !preferences.isSuccess || count === 0}
          onClick={() => start.mutate(undefined)}
        >
          <StartIcon aria-hidden="true" />
          {t(start.isPending ? 'PracticeStarting' : 'PracticeStartQuiz')}
        </Button>
      </Practice.StageFooter>
    </Practice.Stage>
  );
}

function QuizAttempt({
  id,
  material
}: {
  id: typeof quizAttemptIdSchema.Type;
  material: MaterialVersionDetailDto['material_id'];
}) {
  const state = rpc.learning.attempt.useQuery({ attemptId: id });
  const heading = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const answer = useNativeAction(async (input: typeof answerQuestionInputSchema.Type) => {
    if (state.data?.practiceSlotId)
      await rpc.learning.answerPracticeQuestion.call({
        slotId: state.data.practiceSlotId,
        answer: input.answer
      });
    else await rpc.learning.answerQuestion.call(input);

    setSelected(null);
    heading.current?.focus();
  });
  const finish = rpc.learning.finishQuiz.useMutation();

  return (
    <AttemptState state={state} material={material}>
      {(attempt) =>
        attempt.status === 'completed' ? (
          <QuizResults attempt={attempt} />
        ) : (
          <AttemptQuestions
            attempt={attempt}
            selected={selected}
            select={setSelected}
            heading={heading}
            pending={answer.isPending}
            submit={answer.mutate}
            finishing={finish.isPending}
            finish={() => {
              void finish.mutate({ attemptId: id }).catch(() => {});
            }}
            answerError={answer.isError}
            finishError={finish.isError}
          />
        )
      }
    </AttemptState>
  );
}

function AttemptQuestions({
  attempt,
  selected,
  select,
  heading,
  pending,
  submit,
  finishing,
  finish,
  answerError,
  finishError
}: {
  attempt: typeof quizAttemptInProgressSchema.Type;
  selected: number | null;
  select: (index: number | null) => void;
  heading: RefObject<HTMLDivElement | null>;
  pending: boolean;
  submit: (input: typeof answerQuestionInputSchema.Type) => void;
  finishing: boolean;
  finish: () => void;
  answerError: boolean;
  finishError: boolean;
}) {
  const { t, locale } = useI18n();
  const index = selected ?? attempt.questions.findIndex((question) => question.answer === null);
  const question = attempt.questions[index];
  const answered = attempt.questions.filter((item) => item.answer !== null).length;
  const previous = index > 0 ? () => select(index - 1) : undefined;
  const review = answered === attempt.questions.length ? () => select(null) : undefined;
  const error = answerError ? <OperationError /> : undefined;

  return (
    <Practice.Active ref={heading} tabIndex={-1}>
      <Practice.ProgressHeading>
        <span>{question ? questionNumber(locale, index + 1) : t('PracticeAllAnswered')}</span>
        <span>{reviewProgress(locale, answered, attempt.questions.length)}</span>
      </Practice.ProgressHeading>
      <Practice.Progress
        max={attempt.questions.length}
        value={answered}
        aria-label={t('PracticeProgress')}
      />
      {question ? (
        <QuizQuestion
          key={String(question.id)}
          question={question}
          last={answered === attempt.questions.length - 1}
          pending={pending}
          error={error}
          previous={previous}
          review={review}
          submit={(value) =>
            submit({ attemptId: attempt.id, questionId: question.id, answer: value })
          }
        />
      ) : (
        <QuizFinish
          attempt={attempt}
          select={select}
          finishing={finishing}
          finish={finish}
          finishError={finishError}
        />
      )}
    </Practice.Active>
  );
}

export function OperationError({ retry }: { retry?: () => void }) {
  const { t } = useI18n();

  return (
    <ErrorState
      layout="inline"
      title={t('PracticeActionError')}
      action={
        retry ? (
          <Button variant="ghost" onClick={retry}>
            {t('LibraryRefresh')}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Identify each canonical question kind without presenting its answer key. */
function QuizOutline({ version }: { version: MaterialVersionDetailDto }) {
  const { t } = useI18n();

  if (version.content.kind !== 'quiz') return null;

  return (
    <Practice.Outline aria-label={t('PracticeQuestionOutline')}>
      <Practice.OutlineItems
        items={version.content.questions.map((question) => ({
          key: String(question.id),
          prompt: question.prompt,
          detail: t(
            question.kind === 'ordering'
              ? 'PracticeOrdering'
              : question.kind === 'matching'
                ? 'PracticeMatching'
                : question.kind === 'true_false'
                  ? 'PracticeTrueFalse'
                  : question.kind === 'fill_blank'
                    ? 'PracticeFillBlank'
                    : question.kind === 'open'
                      ? 'QuestionOpen'
                      : 'QuestionChoice'
          )
        }))}
      />
    </Practice.Outline>
  );
}

/** Returns localized saved text or selected choice labels for review, leaving unanswered questions empty. */
function savedAnswer(
  t: ReturnType<typeof useI18n>['t'],
  question: (typeof quizAttemptInProgressSchema.Type)['questions'][number]
) {
  const answer = question.answer;

  if (!answer) return null;

  if (answer.type === 'ordering' && question.kind === 'ordering')
    return answer.itemIds
      .map((id) => question.items.find((item) => item.id === id)?.text ?? '')
      .join(' → ');

  if (answer.type === 'open') return answer.answer;

  if (question.kind === 'matching' && answer.type === 'matching')
    return question.terms
      .map((term) => {
        const selected = answer.associations.find((a) => a.termId === term.id);

        return `${term.text}: ${question.definitions.find((d) => d.id === selected?.definitionId)?.text ?? ''}`;
      })
      .join('; ');

  if (!('choices' in question) || answer.type !== 'choice') return null;

  return question.choices
    .filter((choice) => answer.choiceIds.includes(choice.id))
    .map((choice) =>
      question.kind === 'true_false'
        ? t(choice.text === 'true' ? 'PracticeTrue' : 'PracticeFalse')
        : choice.text
    )
    .join(', ');
}

function QuizFinish({
  attempt,
  select,
  finishing,
  finish,
  finishError
}: {
  attempt: typeof quizAttemptInProgressSchema.Type;
  select: (index: number | null) => void;
  finishing: boolean;
  finish: () => void;
  finishError: boolean;
}) {
  const { t, locale } = useI18n();

  return (
    <Practice.Stage>
      <Practice.StageBody>
        <Practice.Intro>
          <h2>{t('QuizReviewAnswers')}</h2>
          <p>{t('PracticeFinishHint')}</p>
        </Practice.Intro>
        <Practice.ReviewList>
          {attempt.questions.map((item, position) => (
            <Practice.ReviewItem key={String(item.id)}>
              <div>
                <small>{questionNumber(locale, position + 1)}</small>
                <h3>{item.prompt}</h3>
                <p>{savedAnswer(t, item) ?? t('PracticeUnanswered')}</p>
              </div>
              <Button
                variant="ghost"
                onClick={() => select(position)}
                disabled={finishing}
                aria-label={`${t('QuizEditAnswer')}: ${questionNumber(locale, position + 1)}`}
              >
                {t('QuizEditAnswer')}
              </Button>
            </Practice.ReviewItem>
          ))}
        </Practice.ReviewList>
        {finishError && <OperationError retry={() => finish()} />}
      </Practice.StageBody>
      <Practice.StageFooter>
        <Practice.FooterContext>
          <Practice.MutedText>{t('PracticeQuizSaveHint')}</Practice.MutedText>
        </Practice.FooterContext>
        <NextButton
          disabled={finishing}
          onClick={() => finish()}
          label={t(finishing ? 'PracticeSaving' : 'PracticeFinishQuiz')}
        ></NextButton>
      </Practice.StageFooter>
    </Practice.Stage>
  );
}
