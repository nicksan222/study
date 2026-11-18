import { writtenExamAnswerLimit } from '@study/contracts';
import type { WrittenExamInput, WrittenExamResult } from '@study/contracts';
import { BackIcon, MoreActionsIcon, SendIcon } from '@study/icons';
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
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Practice,
  WorkspaceSurface
} from '@study/ui';
import { Navigate, useBlocker, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { useWrittenExamRequest } from './written-exam-request';
import { useWrittenExamOpening } from './written-exam-state';
import type { ExamOpening } from './written-exam-state';

type Step = WrittenExamInput['step'];

type ExamTurn = Extract<Step, { kind: 'answer' }>['history'][number];

type Prompt = Omit<ExamTurn, 'answer'>;

type ExchangeEntry = Prompt & { answer?: string };

type Summary = Extract<WrittenExamResult, { kind: 'summary' }>;

type Action = 'answer' | 'hint' | 'finish' | 'submit-and-finish';

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

  if (kind === 'finish') return { kind, concept, history };

  if (!draft) return undefined;

  const entry = { ...current, answer: draft };
  const [first, ...rest] = history;
  const submitted = first ? ([first, ...rest, entry] as const) : ([entry] as const);

  return { kind: kind === 'answer' ? 'answer' : 'finish', concept, history: submitted };
}

function useExamConversation(opening: ExamOpening) {
  const readiness = useAiReadiness('medium', 'chatgpt');
  const turn = useWrittenExamRequest();
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

  const advance = async (kind: Action) => {
    if (blocked || turn.busy()) return;

    const step = requestStep(kind, opening.concept, history, current, draft);

    if (!step || step.kind === 'start') return;

    setPending(kind);

    if (kind === 'answer') composer.current?.focus({ preventScroll: true });
    else composer.current?.blur();

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

export function WrittenExamPage() {
  const { project } = useSearch({ from: '/practice/written-exam' });
  const { session: opening } = useWrittenExamOpening();
  const [session] = useState(opening);

  if (!session || project !== String(session.opening.projectId))
    return <Navigate to="/practice" search={{ project }} replace />;

  return <WrittenExamSession opening={session.opening} />;
}

function WrittenExamSession({ opening }: { opening: ExamOpening }) {
  const { t } = useI18n();
  const model = useExamConversation(opening);
  const router = useRouter();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const active = !model.summary;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      active &&
      (current.pathname !== next.pathname || current.search.project !== next.search.project),
    enableBeforeUnload: active,
    withResolver: true
  });
  const leave = () => router.history.back();
  const { composer } = model;

  useEffect(() => {
    const target = window.matchMedia('(pointer: coarse)').matches ? heading : composer;

    target.current?.focus({ preventScroll: true });
  }, [composer]);

  const transcript =
    model.history.at(-1)?.question === model.current.question
      ? model.history
      : [...model.history, model.current];

  return (
    <Practice.ExamPage aria-label={t('WrittenExam')}>
      <Practice.ExamHeader>
        <IconButton variant="ghost" size="icon" label={t('WrittenExamBack')} onClick={leave}>
          <BackIcon aria-hidden="true" />
        </IconButton>
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {t('WrittenExam')}
          </h1>
          <p>{opening.concept}</p>
        </div>
        {active && <ExamActions model={model} />}
      </Practice.ExamHeader>
      {model.summary ? (
        <ExamResult summary={model.summary} transcript={transcript} />
      ) : (
        <>
          <ExamThread model={model} leave={leave} />
          <ExamComposer model={model} openSettings={() => void navigate({ to: '/settings' })} />
        </>
      )}
      <ExamExitConfirmation
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        exit={() => blocker.proceed?.()}
      />
    </Practice.ExamPage>
  );
}

function ExamExitConfirmation({
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

function isAtEnd(scroller: HTMLDivElement) {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 1;
}

function ExamThread({ model, leave }: { model: Conversation; leave: () => void }) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [canJump, setCanJump] = useState(false);
  const current = {
    ...model.current,
    answer: model.pending === 'answer' ? model.draft : undefined
  };

  useLayoutEffect(() => {
    const scroller = viewport.current;

    following.current = true;
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
  }, [model.current, model.pending, model.failed]);

  useEffect(() => {
    const scroller = viewport.current;

    if (!scroller) return;

    const resize = new ResizeObserver(() => {
      if (following.current) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });

      following.current = isAtEnd(scroller);
      setCanJump(!following.current);
    });

    resize.observe(scroller);

    const content = scroller.firstElementChild;

    if (content) resize.observe(content);

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
            onScroll={({ currentTarget }) => {
              following.current = isAtEnd(currentTarget);
              setCanJump(!following.current);
            }}
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

function ExamActions({ model }: { model: Conversation }) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);

  return (
    <Practice.ExamActions ref={container}>
      <Menu modal={false}>
        <MenuTrigger
          render={<IconButton label={t('WrittenExamActions')} variant="ghost" size="icon" />}
        >
          <MoreActionsIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end" aria-label={t('WrittenExamActions')} portalProps={{ container }}>
          <MenuItem
            disabled={model.blocked || !!model.current.hint}
            onClick={() => void model.advance('hint')}
          >
            {t('WrittenExamHint')}
          </MenuItem>
          <MenuItem disabled={model.blocked} onClick={() => void model.advance('finish')}>
            {t('WrittenExamFinish')}
          </MenuItem>
          {model.draft && (
            <MenuItem
              disabled={model.blocked}
              onClick={() => void model.advance('submit-and-finish')}
            >
              {t('WrittenExamSubmitAndFinish')}
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
    </Practice.ExamActions>
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
      <ComposerSurface.Root variant="notebook">
        <ComposerSurface.Input
          ref={model.composer}
          aria-label={t('StudyChatMessage')}
          placeholder={t('WrittenExamComposer')}
          value={model.answer}
          rows={1}
          maxLength={writtenExamAnswerLimit}
          readOnly={model.pending !== undefined}
          onChange={(event) => model.setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

            event.preventDefault();
            void model.advance('answer');
          }}
        />
        <WorkspaceSurface.ComposerSubmit
          type="submit"
          disabled={model.blocked || !model.draft}
          aria-label={t('SendMessage')}
        >
          <SendIcon aria-hidden="true" />
        </WorkspaceSurface.ComposerSubmit>
      </ComposerSurface.Root>
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
    </>
  );
}
