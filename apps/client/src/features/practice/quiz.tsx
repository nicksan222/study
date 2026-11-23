import { quizAttemptIdSchema, defaultQuizSettings, quizAnswerSchema } from '@study/contracts';
import type {
  ProjectId,
  QuizQuestionId,
  answerQuestionInputSchema,
  quizAttemptInProgressSchema,
  quizAttemptSchema,
  MaterialVersionDetailDto
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { StartIcon, GradeIcon } from '@study/icons';
import { questionNumber, questionCount } from '@study/localization';
import { Button, ErrorState, Practice, QuizSessionView, QuizFinishView } from '@study/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useNativeAction } from '#client/lib/effect/native.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { AttemptState } from './attempt-state';
import { ClientPracticePresentation } from './presentation';
import { QuizGenerationAction } from './quiz-generation';
import { QuizQuestion } from './quiz-question';
import { QuizResults } from './quiz-results';

type ResponseState = {
  questionId: QuizQuestionId;
  previouslyAnswered: boolean;
  phase: 'saving' | 'saved';
};

type QuizSetupProps = { version: MaterialVersionDetailDto; projectId?: ProjectId };

export function Quiz({ version, projectId }: QuizSetupProps) {
  const search = useSearch({ from: '__root__' });

  if (search.attempt)
    return (
      <QuizAttempt
        key={search.attempt}
        id={Schema.decodeUnknownSync(quizAttemptIdSchema)(BigInt(search.attempt))}
        material={version.material_id}
      />
    );

  return <QuizStart version={version} projectId={projectId} />;
}

/** Counts questions matching saved preferences and starts an attempt against the selected immutable version. */
function QuizStart({ version, projectId }: QuizSetupProps) {
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
            <QuizGenerationAction projectId={projectId} />
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
  const committed = useCommittedAttempt(state.data);
  const heading = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const answer = useNativeAction(async (input: typeof answerQuestionInputSchema.Type) => {
    const index =
      committed.attempt?.questions.findIndex((question) => question.id === input.questionId) ?? -1;
    const submitted = {
      questionId: input.questionId,
      previouslyAnswered: committed.attempt?.questions[index]?.answer != null
    };

    setSelected(index);
    setResponse({ ...submitted, phase: 'saving' });

    try {
      const saved = committed.attempt?.practiceSlotId
        ? await rpc.learning.answerPracticeQuestion.call({
            slotId: committed.attempt.practiceSlotId,
            answer: input.answer
          })
        : await rpc.learning.answerQuestion.call(input);

      committed.retain(saved, input.questionId);

      setResponse({ ...submitted, phase: 'saved' });
    } catch (error) {
      setResponse(null);

      throw error;
    }
  });
  const finish = rpc.learning.finishQuiz.useMutation();

  return (
    <AttemptState state={state} material={material}>
      {(live) => {
        const attempt = committed.attempt ?? live;

        return attempt.status === 'completed' ? (
          <QuizResults attempt={attempt} />
        ) : (
          <AttemptQuestions
            attempt={attempt}
            selected={selected}
            response={response}
            continueAfterFeedback={() => {
              setResponse(null);
              setSelected(null);
              heading.current?.focus();
            }}
            select={(index) => {
              setResponse(null);
              setSelected(index);
            }}
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
        );
      }}
    </AttemptState>
  );
}

type Attempt = typeof quizAttemptSchema.Type;

const encodeAnswer = Schema.encodeSync(Schema.toCodecJson(quizAnswerSchema));

/** Keeps a committed mutation visible until its live query observes the saved answer. */
function useCommittedAttempt(live: Attempt | undefined) {
  const [receipt, setReceipt] = useState<{
    attempt: Attempt;
    before: Attempt | undefined;
    questionId: QuizQuestionId;
  } | null>(null);
  const acknowledged = receipt !== null && acknowledgesReceipt(live, receipt);

  if (acknowledged) setReceipt(null);

  return {
    attempt: receipt && !acknowledged ? receipt.attempt : live,
    retain: (attempt: Attempt, questionId: QuizQuestionId) =>
      setReceipt({ attempt, before: live, questionId })
  };
}

function acknowledgesReceipt(
  live: Attempt | undefined,
  receipt: { attempt: Attempt; before: Attempt | undefined; questionId: QuizQuestionId }
) {
  if (!live || live === receipt.before) return false;

  const key = (attempt: Attempt) => {
    const answer = attempt.questions.find((question) => question.id === receipt.questionId)?.answer;

    return answer ? JSON.stringify(encodeAnswer(answer)) : null;
  };

  return key(live) === key(receipt.attempt);
}

function AttemptQuestions({
  attempt,
  selected,
  response,
  continueAfterFeedback,
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
  response: ResponseState | null;
  continueAfterFeedback: () => void;
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
  const review = reviewAction(answered === attempt.questions.length, response, select);
  const error = answerError ? <OperationError /> : undefined;

  return (
    <ClientPracticePresentation>
      <QuizSessionView
        heading={heading}
        label={question ? questionNumber(locale, index + 1) : t('PracticeAllAnswered')}
        answered={answered}
        total={attempt.questions.length}
      >
        {question ? (
          <QuizQuestion
            key={String(question.id)}
            question={question}
            response={questionResponse(attempt, response, continueAfterFeedback)}
            last={index === attempt.questions.length - 1}
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
      </QuizSessionView>
    </ClientPracticePresentation>
  );
}

function reviewAction(
  allAnswered: boolean,
  response: ResponseState | null,
  select: (index: number | null) => void
) {
  if (!allAnswered || (response && !response.previouslyAnswered)) return undefined;

  return () => select(null);
}

function questionResponse(
  attempt: typeof quizAttemptInProgressSchema.Type,
  response: ResponseState | null,
  next: () => void
) {
  if (response?.phase !== 'saved') return undefined;

  return { result: attempt.results?.find((result) => result.id === response.questionId), next };
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
    <QuizFinishView
      rows={attempt.questions.map((item, position) => ({
        key: String(item.id),
        number: questionNumber(locale, position + 1),
        prompt: item.prompt,
        answer: savedAnswer(t, item) ?? t('PracticeUnanswered'),
        editLabel: `${t('QuizEditAnswer')}: ${questionNumber(locale, position + 1)}`
      }))}
      select={select}
      finishing={finishing}
      finish={finish}
      error={finishError ? <OperationError retry={finish} /> : undefined}
    />
  );
}
