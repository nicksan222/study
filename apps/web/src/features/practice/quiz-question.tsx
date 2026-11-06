import type { QuizChoiceId } from '@study/contracts/ids';
import type {
  quizAnswerSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import { Button } from '@study/ui/button';
import { NextButton, PreviousButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import { Textarea } from '@study/ui/textarea';
import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

type Question = (typeof quizAttemptInProgressSchema.Type)['questions'][number];

type Answer = typeof quizAnswerSchema.Type;

export function QuizQuestion({
  question,
  pending,
  submit,
  last,
  previous,
  review,
  error
}: {
  question: Question;
  pending: boolean;
  submit: (answer: Answer) => void;
  last: boolean;
  previous?: () => void;
  review?: () => void;
  error?: ReactNode;
}) {
  const { t } = useI18n();
  const prompt = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    prompt.current?.focus();
  }, [question.id]);
  const [text, setText] = useState(question.answer?.type === 'open' ? question.answer.answer : '');
  const [selected, setSelected] = useState(
    question.answer?.type === 'choice' ? question.answer.choiceIds : []
  );
  const valid = question.kind === 'open' ? text.trim().length > 0 : selected.length > 0;

  function send() {
    if (!valid || pending) return;

    submit(
      question.kind === 'open'
        ? { type: 'open', answer: text.trim() }
        : { type: 'choice', choiceIds: selected }
    );
  }

  return (
    <Practice.Question
      onKeyDown={(event) => {
        if (event.target instanceof HTMLButtonElement) return;

        if (event.key === 'Enter' && question.kind !== 'open') {
          event.preventDefault();
          send();

          return;
        }

        if (pending || question.kind === 'open' || event.metaKey || event.ctrlKey || event.altKey)
          return;

        const choice = question.choices[Number(event.key) - 1];

        if (choice) {
          event.preventDefault();
          setSelected((previous) =>
            toggleChoice(previous, choice.id, question.kind === 'single_choice')
          );
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Practice.StageBody>
        <Practice.Prompt id="practice-question" ref={prompt} tabIndex={-1}>
          {question.prompt}
        </Practice.Prompt>
        <Practice.Muted>{t(questionHint(question.kind))}</Practice.Muted>
        <Practice.Answers disabled={pending} aria-labelledby="practice-question">
          {question.kind === 'open' ? (
            <Textarea
              aria-label={t('YourAnswer')}
              value={text}
              maxLength={100000}
              placeholder={t('PracticeAnswerPlaceholder')}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  send();
                }
              }}
            />
          ) : (
            question.choices.map((choice, index) => (
              <Practice.ChoiceOption
                key={String(choice.id)}
                text={choice.text}
                number={index + 1}
                selected={selected.includes(choice.id)}
                type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
                name="answer"
                value={String(choice.id)}
                onChange={() =>
                  setSelected((previous) =>
                    toggleChoice(previous, choice.id, question.kind === 'single_choice')
                  )
                }
              />
            ))
          )}
        </Practice.Answers>
        {error}
      </Practice.StageBody>
      <QuestionFooter
        previous={previous}
        review={review}
        last={last}
        valid={valid}
        pending={pending}
      />
    </Practice.Question>
  );
}

function toggleChoice(previous: QuizChoiceId[], id: QuizChoiceId, single: boolean) {
  if (single) return [id];

  return previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id];
}

function questionHint(kind: Question['kind']) {
  if (kind === 'open') return 'PracticeOpenHint';

  return kind === 'multiple_choice' ? 'PracticeMultipleHint' : 'PracticeSingleHint';
}

function QuestionFooter({
  previous,
  review,
  last,
  valid,
  pending
}: {
  previous?: () => void;
  review?: () => void;
  last: boolean;
  valid: boolean;
  pending: boolean;
}) {
  const { t } = useI18n();

  return (
    <Practice.StageFooter>
      <Practice.FooterContext>
        {previous && !review && (
          <PreviousButton
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={previous}
            label={t('QuizPrevious')}
          ></PreviousButton>
        )}
        {review && (
          <Button type="button" variant="ghost" disabled={pending} onClick={review}>
            {t('QuizBackToReview')}
          </Button>
        )}
        <Practice.MutedText>
          {t(last ? 'PracticeLastQuestion' : 'PracticeAnswerSaved')}
        </Practice.MutedText>
      </Practice.FooterContext>
      <NextButton
        type="submit"
        disabled={!valid || pending}
        label={t(pending ? 'PracticeSaving' : 'SubmitAnswer')}
      ></NextButton>
    </Practice.StageFooter>
  );
}
