import type {
  MatchingTermId,
  MatchingDefinitionId,
  QuizChoiceId,
  QuizOrderingItemId
} from '@study/contracts/ids';
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

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';

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
  const readiness = useAiReadiness('medium');
  const needsAi = question.kind === 'open' || question.kind === 'fill_blank';
  const blocked = needsAi && readiness !== 'ready';
  const prompt = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    prompt.current?.focus();
  }, [question.id]);
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

  /** Trims text answers and submits a single valid response while no save is pending. */
  function send() {
    if (!valid || pending || blocked) return;

    submit(answerValue(question, text, selected, associations, order));
  }

  const selectChoice = (id: QuizChoiceId) =>
    setSelected((previous) => toggleChoice(previous, id, question.kind !== 'multiple_choice'));

  return (
    <Practice.Question
      onKeyDown={(event) => questionKey(event, question, pending, send, selectChoice)}
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
          <AnswerEditor
            question={question}
            pending={pending}
            text={text}
            setText={setText}
            selected={selected}
            select={selectChoice}
            associations={associations}
            associate={associate}
            clear={(termId) =>
              setAssociations((previous) => previous.filter((a) => a.termId !== termId))
            }
            order={order}
            setOrder={setOrder}
            send={send}
          />
        </Practice.Answers>
        {needsAi && <AiReadinessNotice state={readiness} />}
        {error}
      </Practice.StageBody>
      <QuestionFooter
        previous={previous}
        review={review}
        last={last}
        valid={valid && !blocked}
        pending={pending}
      />
    </Practice.Question>
  );
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
function choiceText(t: ReturnType<typeof useI18n>['t'], kind: Question['kind'], text: string) {
  return kind === 'true_false' ? t(text === 'true' ? 'PracticeTrue' : 'PracticeFalse') : text;
}

/** Present choice responses independently from structured answer editors. */
function ChoiceAnswers({
  question,
  selected,
  select
}: {
  question: Extract<Question, { choices: unknown }>;
  selected: QuizChoiceId[];
  select: (id: QuizChoiceId) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {question.choices.map((choice, index) => (
        <Practice.ChoiceOption
          key={String(choice.id)}
          text={choiceText(t, question.kind, choice.text)}
          number={index + 1}
          selected={selected.includes(choice.id)}
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
  text,
  setText,
  selected,
  select,
  associations,
  associate,
  clear,
  order,
  setOrder,
  send
}: {
  question: Question;
  pending: boolean;
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
}) {
  const { t } = useI18n();

  if (question.kind === 'ordering')
    return (
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
    );

  if (question.kind === 'matching')
    return (
      <MatchingAnswers
        question={question}
        pending={pending}
        associations={associations}
        associate={associate}
        clear={clear}
      />
    );

  if ('choices' in question)
    return <ChoiceAnswers question={question} selected={selected} select={select} />;

  return <TextAnswer kind={question.kind} text={text} setText={setText} send={send} />;
}
