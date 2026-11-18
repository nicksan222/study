import { writtenExamAnswerLimit } from '@study/contracts';
import type { WrittenExamInput, WrittenExamResult } from '@study/contracts';
import { SendIcon } from '@study/icons';
import {
  AiActivity,
  Bubble,
  BubbleContent,
  Button,
  ComposerSurface,
  Dialog,
  DialogDismissButton,
  DialogFooter,
  DialogHeading,
  DialogPopup,
  Disclosure,
  ErrorState,
  IconButton,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Practice
} from '@study/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { useWrittenExamRequest } from './written-exam-request';
import type { TrackExamRequest } from './written-exam-request';

export type ExamOpening = Pick<WrittenExamInput, 'projectId' | 'inputs'> &
  Omit<Extract<WrittenExamResult, { kind: 'opening' }>, 'kind'>;

type Step = WrittenExamInput['step'];

type ExamTurn = Extract<Step, { kind: 'answer' }>['history'][number];

type Prompt = Omit<ExamTurn, 'answer'>;

type ExchangeEntry = Prompt & { answer?: string };

type Summary = Extract<WrittenExamResult, { kind: 'summary' }>;

type Action = 'answer' | 'hint' | 'finish';

function withAnswer(history: readonly ExamTurn[], prompt: Prompt, draft: string) {
  return draft ? [...history, { ...prompt, answer: draft }] : history;
}

function requestStep(
  kind: Action,
  concept: string,
  history: readonly ExamTurn[],
  current: Prompt,
  draft: string
): Step | undefined {
  if (kind === 'hint') {
    if (!current.hint) return { kind, concept, history, current, ...(draft ? { draft } : {}) };

    return undefined;
  }

  if (kind === 'answer' && !draft) return undefined;

  const [first, ...rest] = withAnswer(history, current, draft);

  if (first) return { kind, concept, history: [first, ...rest] };
}

function useExamConversation(
  opening: ExamOpening,
  completed: () => void,
  trackRequest: TrackExamRequest
) {
  const readiness = useAiReadiness('medium', 'chatgpt');
  const turn = useWrittenExamRequest(trackRequest);
  const [history, setHistory] = useState<readonly ExamTurn[]>([]);
  const [current, setCurrent] = useState<Prompt>({ question: opening.question });
  const [summary, setSummary] = useState<Summary>();
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState<Action>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const draft = answer.trim();
  const blocked = pending !== undefined || readiness !== 'ready';
  const error = turn.isError ? toStudyError(turn.error).kind : undefined;
  const sourceUnavailable = error === 'invalid_input' || error === 'not_found';

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) composer.current?.focus();
  }, []);

  const advance = async (kind: Action) => {
    if (blocked || turn.busy()) return;

    const step = requestStep(kind, opening.concept, history, current, draft);

    if (!step || step.kind === 'start') return;

    setPending(kind);
    composer.current?.focus();

    try {
      const next = await turn.run({ projectId: opening.projectId, inputs: opening.inputs, step });

      if (!next) return;

      if (next.kind === 'hint') setCurrent({ ...current, hint: next.message });

      if (next.kind === 'question') {
        setHistory(step.history);
        setCurrent({ question: next.question, reply: next.reply });
        setAnswer('');
      }

      if (next.kind === 'summary') {
        setHistory(step.history);
        setSummary(next);
        completed();
      }
    } finally {
      setPending(undefined);
    }
  };

  return {
    history,
    current,
    summary,
    answer,
    setAnswer,
    composer,
    draft,
    readiness,
    blocked,
    pending,
    failed: error !== undefined,
    sourceUnavailable,
    advance
  };
}

type Conversation = ReturnType<typeof useExamConversation>;

export function WrittenExamSession({
  opening,
  completed,
  trackRequest,
  openSettings,
  leave
}: {
  opening: ExamOpening;
  completed: () => void;
  trackRequest: TrackExamRequest;
  openSettings: () => void;
  leave: () => void;
}) {
  const { t } = useI18n();
  const model = useExamConversation(opening, completed, trackRequest);
  const transcript =
    model.history.at(-1)?.question === model.current.question
      ? model.history
      : [...model.history, model.current];

  return (
    <>
      <DialogHeading title={t('WrittenExam')} description={opening.concept} density="compact" />
      {model.summary ? (
        <ExamResult summary={model.summary} transcript={transcript} />
      ) : (
        <>
          <ExamThread model={model} leave={leave} />
          <ExamComposer model={model} openSettings={openSettings} />
        </>
      )}
    </>
  );
}

export function ExamExitConfirmation({
  open,
  onOpenChange,
  exit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exit: () => void;
}) {
  const { t } = useI18n();
  const abandoned = useRef(false);

  useEffect(() => {
    if (open) abandoned.current = false;
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        closeLabel={t('Close')}
        showCloseButton={false}
        finalFocus={() => !abandoned.current}
      >
        <DialogHeading title={t('WrittenExamExitTitle')} description={t('WrittenExamExitHelp')} />
        <DialogFooter>
          <DialogDismissButton label={t('WrittenExamContinue')} />
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              abandoned.current = true;
              exit();
            }}
          >
            {t('WrittenExamExit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ExamThread({ model, leave }: { model: Conversation; leave: () => void }) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const [canJump, setCanJump] = useState(false);
  const current = {
    ...model.current,
    answer: model.pending === 'answer' ? model.draft : undefined
  };

  useLayoutEffect(() => {
    const scroller = viewport.current;

    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
  }, [model.current, model.pending, model.failed]);

  useEffect(() => {
    const scroller = viewport.current;

    if (!scroller) return;

    const resize = new ResizeObserver(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
    });

    resize.observe(scroller);

    return () => resize.disconnect();
  }, []);

  return (
    <Practice.ExamBody>
      <MessageScrollerProvider defaultScrollPosition="start">
        <MessageScroller>
          <MessageScrollerViewport
            ref={viewport}
            aria-label={t('WrittenExamConversation')}
            preserveScrollOnPrepend={false}
            onScroll={({ currentTarget }) =>
              setCanJump(
                currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight >
                  1
              )
            }
          >
            <MessageScrollerContent aria-label={t('WrittenExamConversation')}>
              {model.history.map((entry) => (
                <Exchange key={entry.question} entry={entry} />
              ))}
              <Exchange
                key={current.question}
                entry={current}
                askingHint={model.pending === 'hint'}
              />
              {model.pending && (
                <MessageScrollerItem>
                  <AiActivity label={t('WrittenExamThinking')} />
                </MessageScrollerItem>
              )}
              {model.failed && !model.pending && (
                <MessageScrollerItem>
                  <ErrorState
                    layout="inline"
                    title={t(
                      model.sourceUnavailable
                        ? 'WrittenExamSourceUnavailable'
                        : 'WrittenExamTurnError'
                    )}
                    action={
                      model.sourceUnavailable && (
                        <Button size="sm" variant="outline" onClick={leave}>
                          {t('WrittenExamExit')}
                        </Button>
                      )
                    }
                  />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {canJump && <MessageScrollerButton aria-label={t('JumpToLatest')} />}
        </MessageScroller>
      </MessageScrollerProvider>
    </Practice.ExamBody>
  );
}

function Exchange({ entry, askingHint }: { entry: ExchangeEntry; askingHint?: boolean }) {
  const { t } = useI18n();

  return (
    <>
      <MessageScrollerItem messageId={entry.question}>
        <ExamMessage text={[entry.reply, entry.question].filter(Boolean).join('\n\n')} />
      </MessageScrollerItem>
      {(entry.hint || askingHint) && (
        <MessageScrollerItem messageId={`${entry.question}:hint-request`}>
          <ExamMessage fromLearner text={t('WrittenExamHintRequest')} />
        </MessageScrollerItem>
      )}
      {entry.hint && (
        <MessageScrollerItem messageId={`${entry.question}:hint`}>
          <ExamMessage text={entry.hint} />
        </MessageScrollerItem>
      )}
      {entry.answer && (
        <MessageScrollerItem messageId={`${entry.question}:answer`}>
          <ExamMessage fromLearner text={entry.answer} />
        </MessageScrollerItem>
      )}
    </>
  );
}

function ExamMessage({ text, fromLearner = false }: { text: string; fromLearner?: boolean }) {
  const { t } = useI18n();
  const label = t(fromLearner ? 'NoteContextYou' : 'WrittenExamExaminer');

  return (
    <Message align={fromLearner ? 'end' : 'start'} role="article" aria-label={label}>
      <MessageContent>
        <MessageHeader>{label}</MessageHeader>
        <Bubble align={fromLearner ? 'end' : 'start'} variant={fromLearner ? 'muted' : 'ghost'}>
          <BubbleContent>{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function ExamComposer({ model, openSettings }: { model: Conversation; openSettings: () => void }) {
  const { t } = useI18n();

  return (
    <Practice.ExamAnswer
      onSubmit={(event) => {
        event.preventDefault();
        void model.advance('answer');
      }}
    >
      <ComposerSurface.Input
        ref={model.composer}
        aria-label={t('StudyChatMessage')}
        placeholder={t('WrittenExamComposer')}
        value={model.answer}
        rows={2}
        maxLength={writtenExamAnswerLimit}
        readOnly={model.pending !== undefined}
        onChange={(event) => model.setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

          event.preventDefault();
          void model.advance('answer');
        }}
      />
      <Practice.ExamActions>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={model.blocked || !!model.current.hint}
          onClick={() => void model.advance('hint')}
        >
          {t('WrittenExamHint')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={model.blocked || !(model.history.length || model.draft)}
          onClick={() => void model.advance('finish')}
        >
          {t('WrittenExamFinish')}
        </Button>
        <IconButton
          type="submit"
          size="icon"
          variant="default"
          disabled={model.blocked || !model.draft}
          label={t('SendMessage')}
        >
          <SendIcon aria-hidden="true" />
        </IconButton>
      </Practice.ExamActions>
      <AiReadinessNotice
        state={model.readiness}
        setupLabel={t('WrittenExamChatGptSetup')}
        onOpenSettings={openSettings}
      />
    </Practice.ExamAnswer>
  );
}

function ExamResult({
  summary,
  transcript
}: {
  summary: Summary;
  transcript: readonly ExchangeEntry[];
}) {
  const { t } = useI18n();
  const prompt = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    prompt.current?.focus();
  }, []);

  return (
    <>
      <Practice.ExamResult>
        <Practice.ExamPrompt ref={prompt} tabIndex={-1}>
          {t(summary.understood ? 'WrittenExamUnderstood' : 'WrittenExamNeedsReview')}
        </Practice.ExamPrompt>
        <Practice.ExamFeedback>{summary.feedback}</Practice.ExamFeedback>
        <Disclosure summary={t('WrittenExamHistory')}>
          <MessageScrollerProvider defaultScrollPosition="start">
            <Practice.ExamTranscript>
              {transcript.map((entry) => (
                <Exchange key={entry.question} entry={entry} />
              ))}
            </Practice.ExamTranscript>
          </MessageScrollerProvider>
        </Disclosure>
      </Practice.ExamResult>
      <DialogFooter>
        <DialogDismissButton label={t('Close')} />
      </DialogFooter>
    </>
  );
}
