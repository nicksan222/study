import { useState, useEffect, useRef, useId } from 'react';
import type { ReactNode, KeyboardEvent, RefObject } from 'react';

import { Button } from '#ui/components/button.tsx';
import { Input } from '#ui/components/input.tsx';
import { NextButton, PreviousButton } from '#ui/components/navigation-button.tsx';
import { Practice } from '#ui/components/practice.tsx';
import { SelectControl } from '#ui/components/select-control.tsx';
import { Textarea } from '#ui/components/textarea.tsx';

import { usePracticePresentation } from './practice-presentation';
import type {
  PracticeQuestionModel,
  PracticeAnswer,
  PracticeResultQuestionModel
} from './practice-question-model';
import { QuizQuestionFeedbackView } from './quiz-results-view';

type MatchingTermId = string;

type MatchingDefinitionId = string;

type QuizChoiceId = bigint;

type QuizOrderingItemId = bigint;

type Question = PracticeQuestionModel;

type OpenAnswerRenderer = (props: {
  text: string;
  setText: (text: string) => void;
  send: () => void;
  disabled: boolean;
  label: string;
  placeholder: string;
}) => ReactNode;

type Answer = PracticeAnswer;

/** Present an attempt question, restore its saved answer and submit only a complete response. */
export function QuizQuestionView({
  question,
  pending,
  submit,
  last,
  previous,
  review,
  error,
  blocked = false,
  notice,
  renderOpenAnswer,
  autoFocus = true,
  response
}: {
  question: Question;
  pending: boolean;
  submit: (answer: Answer) => void;
  last: boolean;
  previous?: () => void;
  review?: () => void;
  error?: ReactNode;
  blocked?: boolean;
  notice?: ReactNode;
  renderOpenAnswer?: OpenAnswerRenderer;
  autoFocus?: boolean;
  response?: { result?: PracticeResultQuestionModel; next: () => void };
}) {
  const { t } = usePracticePresentation();
  const questionId = useId();
  const submitted = response !== undefined;
  const { prompt, action } = useQuestionFocus(question.id, autoFocus, submitted, pending);
  const {
    text,
    setText,
    selected,
    selectChoice,
    associations,
    associate,
    clear,
    order,
    setOrder,
    valid,
    answer
  } = useAnswerDraft(question);
  const { locked, submittable, canContinue } = questionInteraction(
    valid,
    pending,
    blocked,
    submitted
  );

  /** Trims text answers and submits a single valid response while no save is pending. */
  function send() {
    if (!submittable) return;

    submit(answer());
  }

  const submitResponse = response?.next ?? send;

  return (
    <Practice.Question
      data-reviewed={submitted}
      onKeyDown={(event) => questionKey(event, question, locked, send, selectChoice)}
      onSubmit={(event) => {
        event.preventDefault();

        submitResponse();
      }}
    >
      <Practice.StageBody>
        <Practice.Prompt id={questionId} ref={prompt} tabIndex={-1}>
          {question.prompt}
        </Practice.Prompt>
        <Practice.Muted>{t(questionHint(question.kind))}</Practice.Muted>
        <Practice.Answers disabled={locked} aria-labelledby={questionId}>
          <AnswerEditor
            question={question}
            pending={locked}
            result={response?.result}
            text={text}
            setText={setText}
            selected={selected}
            select={selectChoice}
            associations={associations}
            associate={associate}
            clear={clear}
            order={order}
            setOrder={setOrder}
            send={send}
            renderOpenAnswer={renderOpenAnswer}
          />
        </Practice.Answers>
        {!submitted && notice}
        {error}
        <QuestionFeedback result={response?.result} />
      </Practice.StageBody>
      <QuestionFooter
        previous={previous}
        review={review}
        last={last}
        valid={canContinue}
        pending={pending}
        action={action}
        next={response?.next}
      />
    </Practice.Question>
  );
}

function questionInteraction(
  valid: boolean,
  pending: boolean,
  blocked: boolean,
  submitted: boolean
) {
  const locked = pending || submitted;
  const canSend = valid && !blocked;

  return { locked, submittable: canSend && !locked, canContinue: submitted || canSend };
}

function useAnswerDraft(question: Question) {
  const restored = restoredAnswer(question.answer);
  const [text, setText] = useState(restored.text);
  const [selected, setSelected] = useState(restored.selected);
  const [associations, setAssociations] = useState(restored.associations);
  const [order, setOrder] = useState(() => initialOrder(question));
  const valid = validAnswer(question, text, selected, associations, order);

  function associate(termId: MatchingTermId, definitionId: MatchingDefinitionId) {
    setAssociations((previous) => [
      ...previous.filter((a) => a.termId !== termId && a.definitionId !== definitionId),
      { termId, definitionId }
    ]);
  }

  const selectChoice = (id: QuizChoiceId) =>
    setSelected((previous) => toggleChoice(previous, id, question.kind !== 'multiple_choice'));

  const clear = (termId: MatchingTermId) =>
    setAssociations((previous) => previous.filter((association) => association.termId !== termId));

  return {
    text,
    setText,
    selected,
    selectChoice,
    associations,
    associate,
    clear,
    order,
    setOrder,
    valid,
    answer: () => answerValue(question, text, selected, associations, order)
  };
}

function useQuestionFocus(id: bigint, autoFocus: boolean, submitted: boolean, pending: boolean) {
  const prompt = useRef<HTMLHeadingElement>(null);
  const action = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (submitted && !pending) action.current?.focus({ preventScroll: true });
  }, [submitted, pending]);
  useEffect(() => {
    if (autoFocus) prompt.current?.focus();
  }, [id, autoFocus]);

  return { prompt, action };
}

function QuestionFeedback({ result }: { result?: PracticeResultQuestionModel }) {
  return result ? (
    <Practice.Feedback>
      <QuizQuestionFeedbackView question={result} />
    </Practice.Feedback>
  ) : null;
}

function restoredAnswer(answer: Question['answer']) {
  return {
    text: answer?.type === 'open' ? answer.answer : '',
    selected: answer?.type === 'choice' ? answer.choiceIds : [],
    associations: answer?.type === 'matching' ? answer.associations : []
  };
}

function questionKey(
  event: KeyboardEvent<HTMLFormElement>,
  question: Question,
  pending: boolean,
  send: () => void,
  select: (id: QuizChoiceId) => void
) {
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
    select(choice.id);
  }
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
  if (kind === 'ordering') return 'PracticeOrderingHint';

  if (kind === 'matching') return 'PracticeMatchingHint';

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
  pending,
  action,
  next
}: {
  previous?: () => void;
  review?: () => void;
  last: boolean;
  valid: boolean;
  pending: boolean;
  action: RefObject<HTMLButtonElement | null>;
  next?: () => void;
}) {
  const { t } = usePracticePresentation();
  const disabled = !valid || pending;

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
      {next ? (
        <NextButton
          ref={action}
          onClick={next}
          disabled={disabled}
          label={t(pending ? 'PracticeSaving' : 'PracticeNextQuestion')}
        ></NextButton>
      ) : (
        <Button ref={action} type="submit" disabled={disabled}>
          {t(pending ? 'PracticeSaving' : 'SubmitAnswer')}
        </Button>
      )}
    </Practice.StageFooter>
  );
}

/** Require a full matching permutation or a nonempty response for text and choice questions. */
function validAnswer(
  question: Question,
  text: string,
  selected: QuizChoiceId[],
  associations: Extract<Answer, { type: 'matching' }>['associations'],
  order: QuizOrderingItemId[]
) {
  if (question.kind === 'ordering') return order.length === question.items.length;

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
  clear,
  result
}: {
  result?: PracticeResultQuestionModel;
  question: Extract<Question, { kind: 'matching' }>;
  pending: boolean;
  associations: Extract<Answer, { type: 'matching' }>['associations'];
  associate: (termId: MatchingTermId, definitionId: MatchingDefinitionId) => void;
  clear: (termId: MatchingTermId) => void;
}) {
  const { t } = usePracticePresentation();

  return (
    <>
      {question.terms.map((term) => (
        <Practice.MatchingRow
          key={term.id}
          data-tone={
            result?.kind === 'matching'
              ? result.pairs.find((pair) => pair.termId === term.id)?.score === 1
                ? 'correct'
                : 'incorrect'
              : undefined
          }
        >
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
  send,
  disabled,
  renderOpenAnswer
}: {
  kind: 'open' | 'fill_blank';
  text: string;
  setText: (text: string) => void;
  send: () => void;
  disabled?: boolean;
  renderOpenAnswer?: OpenAnswerRenderer;
}) {
  const { t } = usePracticePresentation();

  const answerId = useId();

  if (kind === 'open' && renderOpenAnswer)
    return renderOpenAnswer({
      text,
      setText,
      send,
      disabled: disabled ?? false,
      label: t('YourAnswer'),
      placeholder: t('PracticeAnswerPlaceholder')
    });

  return kind === 'fill_blank' ? (
    <Practice.ShortAnswer>
      <label htmlFor={answerId}>{t('YourAnswer')}</label>
      <Input
        id={answerId}
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

/** Restore the committed learner sequence or the independently shuffled presentation. */
function initialOrder(question: Question): QuizOrderingItemId[] {
  return question.kind === 'ordering'
    ? (question.answer?.itemIds ?? question.items.map((item) => item.id))
    : [];
}

/** Encode each editor variant through the canonical answer contract. */
function answerValue(
  question: Question,
  text: string,
  selected: QuizChoiceId[],
  associations: Extract<Answer, { type: 'matching' }>['associations'],
  order: QuizOrderingItemId[]
): Answer {
  if (question.kind === 'ordering') return { type: 'ordering', itemIds: order };

  if (question.kind === 'matching')
    return {
      type: 'matching',
      associations: question.terms.map((term) => associations.find((a) => a.termId === term.id)!)
    };

  return 'choices' in question
    ? { type: 'choice', choiceIds: selected }
    : { type: 'open', answer: text.trim() };
}

/** Localize canonical truth tokens while preserving source-authored choice text. */
function choiceText(
  t: ReturnType<typeof usePracticePresentation>['t'],
  kind: Question['kind'],
  text: string
) {
  return kind === 'true_false' ? t(text === 'true' ? 'PracticeTrue' : 'PracticeFalse') : text;
}

/** Present choice responses independently from structured answer editors. */
function ChoiceAnswers({
  question,
  selected,
  select,
  result
}: {
  result?: PracticeResultQuestionModel;
  question: Extract<Question, { choices: unknown }>;
  selected: QuizChoiceId[];
  select: (id: QuizChoiceId) => void;
}) {
  const { t } = usePracticePresentation();

  return (
    <>
      {question.choices.map((choice, index) => (
        <Practice.ChoiceOption
          key={String(choice.id)}
          text={choiceText(t, question.kind, choice.text)}
          number={index + 1}
          selected={selected.includes(choice.id)}
          tone={choiceTone(result, choice.id, selected)}
          status={
            result &&
            'choices' in result &&
            result.choices.find((item) => item.id === choice.id)?.isCorrect
              ? t('RightAnswer')
              : result && selected.includes(choice.id)
                ? t('YourAnswer')
                : undefined
          }
          type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
          name="answer"
          value={String(choice.id)}
          onChange={() => select(choice.id)}
        />
      ))}
    </>
  );
}

/** Dispatch each answer editor without nesting independent interaction variants. */
function AnswerEditor({
  question,
  pending,
  result,
  text,
  setText,
  selected,
  select,
  associations,
  associate,
  clear,
  order,
  setOrder,
  send,
  renderOpenAnswer
}: {
  question: Question;
  pending: boolean;
  result?: PracticeResultQuestionModel;
  text: string;
  setText: (text: string) => void;
  selected: QuizChoiceId[];
  select: (id: QuizChoiceId) => void;
  associations: Extract<Answer, { type: 'matching' }>['associations'];
  associate: (termId: MatchingTermId, definitionId: MatchingDefinitionId) => void;
  clear: (termId: MatchingTermId) => void;
  order: QuizOrderingItemId[];
  setOrder: (update: (previous: QuizOrderingItemId[]) => QuizOrderingItemId[]) => void;
  send: () => void;
  renderOpenAnswer?: OpenAnswerRenderer;
}) {
  const { t } = usePracticePresentation();

  if (question.kind === 'ordering')
    return (
      <Practice.Ordering
        label={t('YourAnswer')}
        items={order.map((id, position) => ({
          tone: orderingTone(result, id, position),
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
    );

  if (question.kind === 'matching')
    return (
      <MatchingAnswers
        question={question}
        pending={pending}
        associations={associations}
        associate={associate}
        clear={clear}
        result={result}
      />
    );

  if ('choices' in question)
    return (
      <ChoiceAnswers question={question} selected={selected} select={select} result={result} />
    );

  return (
    <div data-tone={textTone(result)}>
      <TextAnswer
        kind={question.kind}
        text={text}
        setText={setText}
        send={send}
        disabled={pending}
        renderOpenAnswer={renderOpenAnswer}
      />
    </div>
  );
}

function choiceTone(
  result: PracticeResultQuestionModel | undefined,
  id: bigint,
  selected: bigint[]
) {
  if (!result || !('choices' in result)) return undefined;

  if (result.choices.find((choice) => choice.id === id)?.isCorrect) return 'correct' as const;

  return selected.includes(id) ? ('incorrect' as const) : undefined;
}

function orderingTone(
  result: PracticeResultQuestionModel | undefined,
  id: bigint,
  position: number
) {
  if (result?.kind !== 'ordering') return undefined;

  return result.correctItemIds[position] === id ? ('correct' as const) : ('incorrect' as const);
}

function textTone(result: PracticeResultQuestionModel | undefined) {
  if (result?.score == null) return undefined;

  return result.score === 1 ? 'correct' : 'incorrect';
}
