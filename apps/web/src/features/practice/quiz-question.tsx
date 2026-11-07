import type { QuizChoiceId } from '@study/contracts/ids';
import type {
  quizAnswerSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { NextButton, PreviousButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import { Textarea } from '@study/ui/textarea';
import { useState, useEffect, useRef } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

type Question = (typeof quizAttemptInProgressSchema.Type)['questions'][number];

type Answer = typeof quizAnswerSchema.Type;

/** Restores a saved response and submits valid typed answers, preserving multiline entry and IME composition. */
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
  const valid = !('choices' in question) ? text.trim().length > 0 : selected.length > 0;

  /** Trims text answers and submits a single valid response while no save is pending. */
  function send() {
    if (!valid || pending) return;

    submit(
      !('choices' in question)
        ? { type: 'open', answer: text.trim() }
        : { type: 'choice', choiceIds: selected }
    );
  }

  return (
    <Practice.Question
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;

        if (event.target instanceof HTMLButtonElement) return;

        if (event.key === 'Enter' && question.kind !== 'open') {
          event.preventDefault();
          send();

          return;
        }

        if (pending || !('choices' in question) || hasModifier(event)) return;

        const choice = question.choices[Number(event.key) - 1];

        if (choice) {
          event.preventDefault();
          setSelected((previous) =>
            toggleChoice(previous, choice.id, question.kind !== 'multiple_choice')
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
          {question.kind === 'fill_blank' ? (
            <Practice.ShortAnswer>
              <label htmlFor="practice-answer">{t('YourAnswer')}</label>
              <Input
                id="practice-answer"
                value={text}
                maxLength={100000}
                placeholder={t('PracticeFillBlankPlaceholder')}
                autoComplete="off"
                onChange={(event) => setText(event.target.value)}
              />
            </Practice.ShortAnswer>
          ) : question.kind === 'open' ? (
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
                text={
                  question.kind === 'true_false'
                    ? t(choice.text === 'true' ? 'PracticeTrue' : 'PracticeFalse')
                    : choice.text
                }
                number={index + 1}
                selected={selected.includes(choice.id)}
                type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
                name="answer"
                value={String(choice.id)}
                onChange={() =>
                  setSelected((previous) =>
                    toggleChoice(previous, choice.id, question.kind !== 'multiple_choice')
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

/** Keeps browser and application shortcuts out of numeric choice selection. */
function hasModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function toggleChoice(previous: QuizChoiceId[], id: QuizChoiceId, single: boolean) {
  if (single) return [id];

  return previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id];
}

function questionHint(kind: Question['kind']) {
  if (kind === 'true_false') return 'PracticeTrueFalseHint';

  if (kind === 'fill_blank') return 'PracticeFillBlankHint';

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
