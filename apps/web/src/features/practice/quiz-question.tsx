import type { MatchingTermId, MatchingDefinitionId, QuizChoiceId } from '@study/contracts/ids';
import type {
  quizAnswerSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { NextButton, PreviousButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import { SelectControl } from '@study/ui/select-control';
import { Textarea } from '@study/ui/textarea';
import { useState, useEffect, useRef } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

type Question = (typeof quizAttemptInProgressSchema.Type)['questions'][number];

type Answer = typeof quizAnswerSchema.Type;

/** Present an attempt question, restore its saved answer and submit only a complete response. */
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
  const [associations, setAssociations] = useState(
    question.answer?.type === 'matching' ? question.answer.associations : []
  );
  const valid = validAnswer(question, text, selected, associations);

  function associate(termId: MatchingTermId, definitionId: MatchingDefinitionId) {
    setAssociations((previous) => [
      ...previous.filter((a) => a.termId !== termId && a.definitionId !== definitionId),
      { termId, definitionId }
    ]);
  }

  /** Trims text answers and submits a single valid response while no save is pending. */
  function send() {
    if (!valid || pending) return;

    submit(
      question.kind === 'matching'
        ? {
            type: 'matching',
            associations: question.terms.map((term) =>
              associations.find((a) => a.termId === term.id)!
            )
          }
        : !('choices' in question)
          ? { type: 'open', answer: text.trim() }
          : { type: 'choice', choiceIds: selected }
    );
  }

  return (
    <Practice.Question
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;

        if (event.target instanceof HTMLButtonElement || question.kind === 'matching') return;

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
          {question.kind === 'matching' ? (
            <MatchingAnswers
              question={question}
              pending={pending}
              associations={associations}
              associate={associate}
              clear={(termId) =>
                setAssociations((previous) => previous.filter((a) => a.termId !== termId))
              }
            />
          ) : !('choices' in question) ? (
            <TextAnswer kind={question.kind} text={text} setText={setText} send={send} />
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

function questionHint(kind: Question['kind']) {
  if (kind === 'matching') return 'PracticeMatchingHint';

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

/** Require a full matching permutation or a nonempty response for text and choice questions. */
function validAnswer(
  question: Question,
  text: string,
  selected: QuizChoiceId[],
  associations: Extract<Answer, { type: 'matching' }>['associations']
) {
  if (question.kind === 'matching')
    return (
      associations.length === question.terms.length &&
      new Set(associations.map((a) => a.definitionId)).size === question.terms.length
    );

  return 'choices' in question ? selected.length > 0 : text.trim().length > 0;
}

/** Let keyboard and pointer users associate each term with a stable shuffled definition. */
function MatchingAnswers({
  question,
  pending,
  associations,
  associate,
  clear
}: {
  question: Extract<Question, { kind: 'matching' }>;
  pending: boolean;
  associations: Extract<Answer, { type: 'matching' }>['associations'];
  associate: (termId: MatchingTermId, definitionId: MatchingDefinitionId) => void;
  clear: (termId: MatchingTermId) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {question.terms.map((term) => (
        <Practice.MatchingRow key={term.id}>
          <span>{term.text}</span>
          <SelectControl
            optionText="wrap"
            label={term.text}
            value={associations.find((a) => a.termId === term.id)?.definitionId ?? ''}
            disabled={pending}
            options={[
              { value: '', label: t('PracticeMatchingChoose') },
              ...question.definitions.map((definition) => ({
                value: definition.id,
                label: definition.text
              }))
            ]}
            onValueChange={(value) => {
              const definition = question.definitions.find((d) => d.id === value);

              if (definition) associate(term.id, definition.id);
              else clear(term.id);
            }}
          />
        </Practice.MatchingRow>
      ))}
    </>
  );
}

/** Keep short blank inputs and multiline open answers on their existing keyboard paths. */
function TextAnswer({
  kind,
  text,
  setText,
  send
}: {
  kind: 'open' | 'fill_blank';
  text: string;
  setText: (text: string) => void;
  send: () => void;
}) {
  const { t } = useI18n();

  return kind === 'fill_blank' ? (
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
  ) : (
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
  );
}
