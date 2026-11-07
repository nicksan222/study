import type { QuizChoiceId, QuizOrderingItemId } from '@study/contracts/ids';
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

/** Restores saved answers and submits accessible practice controls through one typed contract. */
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
  const [text, setText] = useState(() => initialAnswer(question).text);
  const [selected, setSelected] = useState(() => initialAnswer(question).selected);
  const [order, setOrder] = useState(() => initialAnswer(question).order);
  const valid = answerValid(question, text, selected, order);

  /** Trims text answers and submits a single valid response while no save is pending. */
  function send() {
    if (!valid || pending) return;

    submit(answerValue(question, text, selected, order));
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
          {question.kind === 'ordering' ? (
            <Practice.Ordering
              label={t('YourAnswer')}
              items={order.map((id) => ({
                key: String(id),
                text: question.items.find((item) => item.id === id)!.text
              }))}
              disabled={pending}
              moveUpLabel={t('PracticeMoveUp')}
              moveDownLabel={t('PracticeMoveDown')}
              move={(index, direction) =>
                setOrder((previous) => {
                  const next = [...previous];

                  [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];

                  return next;
                })
              }
            />
          ) : question.kind === 'fill_blank' ? (
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

/** Keeps browser and application shortcuts out of numeric choice selection. */
function hasModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function toggleChoice(previous: QuizChoiceId[], id: QuizChoiceId, single: boolean) {
  if (single) return [id];

  return previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id];
}

/** Chooses localized interaction and scoring guidance for each question kind. */
function questionHint(kind: Question['kind']) {
  if (kind === 'ordering') return 'PracticeOrderingHint';

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

/** Initializes editable state from the committed response or the attempt presentation. */
function initialAnswer(question: Question): {
  text: string;
  selected: QuizChoiceId[];
  order: QuizOrderingItemId[];
} {
  if (question.kind === 'ordering')
    return {
      text: '',
      selected: [],
      order: question.answer?.itemIds ?? question.items.map((item) => item.id)
    };

  if (question.answer?.type === 'open')
    return { text: question.answer.answer, selected: [], order: [] };

  return { text: '', selected: question.answer?.choiceIds ?? [], order: [] };
}

/** Enables submission only when the current answer has the required shape. */
function answerValid(
  question: Question,
  text: string,
  selected: readonly QuizChoiceId[],
  order: readonly QuizOrderingItemId[]
) {
  if (question.kind === 'ordering') return order.length === question.items.length;

  return 'choices' in question ? selected.length > 0 : text.trim().length > 0;
}

/** Converts editable state into the canonical discriminated answer contract. */
function answerValue(
  question: Question,
  text: string,
  selected: QuizChoiceId[],
  order: QuizOrderingItemId[]
): Answer {
  if (question.kind === 'ordering') return { type: 'ordering', itemIds: order };

  return 'choices' in question
    ? { type: 'choice', choiceIds: selected }
    : { type: 'open', answer: text.trim() };
}
