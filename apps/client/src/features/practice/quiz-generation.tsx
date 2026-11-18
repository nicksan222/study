import {
  defaultQuizSettings,
  practiceGenerationSettings,
  writtenExamTopicLimit
} from '@study/contracts';
import type {
  PageId,
  ProjectId,
  ContentInput,
  materialGenerationInputSchema,
  MaterialVersionDetailDto,
  WrittenExamInput,
  QuizSettings
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  MatchingIcon,
  QuizIcon,
  FlashcardsIcon,
  OptionsIcon,
  ExpandIcon,
  OrderingIcon,
  FillBlankIcon,
  TrueFalseIcon,
  AssistantIcon
} from '@study/icons';
import {
  RetryButton,
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogFooter,
  DialogDismissButton,
  DialogHeading,
  Input,
  Label,
  ErrorState,
  Practice,
  Settings
} from '@study/ui';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import type { SetStateAction } from 'react';
import { useState, useCallback, useEffect, useId, useRef } from 'react';

import {
  DictationSubmissionScope,
  DictationTextarea,
  useDictationSubmission
} from '#client/features/voice/index.ts';
import { AiActionButton as AiButton } from '#client/lib/ai-action-button.tsx';
import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';
import { useNativeAction } from '#client/lib/effect/native.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { GenerationWatcher } from './generation-watcher';
import { QuizInputPicker } from './quiz-input-picker';
import { useWrittenExamRequest } from './written-exam-request';
import type { TrackExamRequest } from './written-exam-request';
import { useWrittenExamOpening } from './written-exam-state';
import type { ExamOpening } from './written-exam-state';

export function QuizGenerationAction({
  projectId
}: {
  version: MaterialVersionDetailDto;
  projectId?: ProjectId;
  title?: string;
}) {
  return <GenerationDialog projectId={projectId} inline />;
}

export function PracticeGenerationAction({
  projectId,
  disabled
}: {
  projectId?: ProjectId;
  disabled?: boolean;
}) {
  const inExam = useLocation({ select: ({ pathname }) => pathname === '/practice/written-exam' });

  if (inExam) return null;

  return <GenerationDialog key={String(projectId)} projectId={projectId} disabled={disabled} />;
}

function useGenerationDialog() {
  const [open, setOpen] = useState(false);
  const session = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const launchHref = useRef<string | undefined>(undefined);
  const router = useRouter();
  const instance = session.current;
  const close = useCallback(() => {
    session.current++;
    request.current?.abort();
    request.current = undefined;
    launchHref.current = undefined;
    setOpen(false);
  }, []);

  useEffect(
    () =>
      router.subscribe('onBeforeNavigate', ({ hrefChanged }) => {
        if (hrefChanged && launchHref.current !== undefined) close();
      }),
    [close, router]
  );

  return {
    open,
    instance,
    trigger,
    changeOpen: (next: boolean) => {
      if (next) {
        launchHref.current = router.history.location.href;
        setOpen(true);
      } else close();
    },
    trackRequest: (controller: AbortController | undefined) => {
      if (session.current === instance) request.current = controller;
    },
    closeAccepted: () => {
      if (session.current !== instance || launchHref.current !== router.history.location.href)
        return false;

      close();

      return true;
    }
  } as const;
}

/** A sidebar launcher can be hidden by a viewport change while its dialog is open. */
function focusAfterGeneration(trigger: HTMLButtonElement | null) {
  const drawer = trigger?.closest('[hidden]')?.querySelector<HTMLElement>('nav[id]');

  if (!drawer) return trigger ?? true;

  return (
    drawer.ownerDocument.querySelector<HTMLElement>(
      `main button[aria-controls="${CSS.escape(drawer.id)}"]`
    ) ?? true
  );
}

function restoreLauncherFocus(launcher: 'inline' | 'sidebar') {
  const trigger = document.querySelector<HTMLButtonElement>(
    `button[data-written-exam-launcher="${launcher}"]`
  );
  const target = focusAfterGeneration(trigger);

  if (target !== true) target.focus({ preventScroll: true });
}

function GenerationDialog({
  projectId,
  inline = false,
  disabled
}: {
  projectId?: ProjectId;
  inline?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { setSession } = useWrittenExamOpening();
  const origin = useLocation({ select: ({ href }) => href });
  const enteringExam = useRef(false);
  const appearance = inline
    ? ({
        launcher: 'inline',
        size: 'default',
        variant: 'outline',
        action: 'PracticeGenerateFromPages'
      } as const)
    : ({
        launcher: 'sidebar',
        size: 'icon',
        variant: 'ghost-muted',
        action: 'PracticeGenerate'
      } as const);
  const label = t(appearance.action);
  const triggerText = inline ? label : undefined;
  const dialog = useGenerationDialog();
  const [requests, setRequests] = useState<string[]>([]);
  const settled = useCallback(
    (id: string) => setRequests((current) => current.filter((request) => request !== id)),
    []
  );

  const openExam = (opening: ExamOpening) => {
    if (!dialog.closeAccepted()) return;

    enteringExam.current = true;
    setSession({
      opening,
      origin,
      restoreFocus: () => restoreLauncherFocus(appearance.launcher)
    });
    void navigate({
      to: '/practice/written-exam',
      search: { project: String(opening.projectId) }
    });
  };

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => {
        if (open) enteringExam.current = false;

        dialog.changeOpen(open);
      }}
    >
      <DialogTrigger
        render={
          <AiButton
            ref={dialog.trigger}
            data-written-exam-launcher={appearance.launcher}
            tier="medium"
            provider="configured-or-chatgpt"
            size={appearance.size}
            variant={appearance.variant}
            label={label}
            disabled={disabled || projectId === undefined}
            disabledReason={projectId === undefined ? t('PracticeChooseSubject') : undefined}
            pending={requests.length > 0}
            workingLabel={t('QuizGenerating')}
          >
            {triggerText}
          </AiButton>
        }
      />
      <DialogPopup
        keepMounted
        finalFocus={() => !enteringExam.current && focusAfterGeneration(dialog.trigger.current)}
        closeLabel={t('Close')}
        variant="practice-generation"
        bottomStickOnMobile={false}
      >
        <DialogHeading title={t('PracticeGenerate')} description={t('PracticeGenerateHelp')} />
        {dialog.open && (
          <GenerationPanel
            key={dialog.instance}
            projectId={projectId}
            accepted={(id) => {
              setRequests((current) => [...current, id]);
              dialog.closeAccepted();
            }}
            examOpened={openExam}
            trackRequest={dialog.trackRequest}
          />
        )}
      </DialogPopup>
      {requests.map((id) => (
        <GenerationWatcher key={id} id={id} settled={settled} />
      ))}
    </Dialog>
  );
}

const generationKinds = [
  { kind: 'quiz', label: 'SidebarQuiz', icon: QuizIcon, help: undefined },
  { kind: 'flashcards', label: 'Flashcards', icon: FlashcardsIcon, help: undefined },
  {
    kind: 'fill_blank',
    label: 'PracticeFillBlank',
    icon: FillBlankIcon,
    help: 'PracticeFillBlankHelp'
  },
  { kind: 'ordering', label: 'PracticeOrdering', icon: OrderingIcon, help: 'PracticeOrderingHelp' },
  { kind: 'matching', label: 'PracticeMatching', icon: MatchingIcon, help: 'PracticeMatchingHelp' },
  {
    kind: 'true_false',
    label: 'PracticeTrueFalse',
    icon: TrueFalseIcon,
    help: 'PracticeTrueFalseHelp'
  },
  { kind: 'exam', label: 'WrittenExam', icon: AssistantIcon, help: 'WrittenExamHelp' }
] as const;

type GenerationKind = (typeof generationKinds)[number]['kind'];

function quizConfiguration(kind: Exclude<GenerationKind, 'exam'>, settings: QuizSettings) {
  if (kind === 'flashcards') return undefined;

  const configuration = kind === 'quiz' ? settings : practiceGenerationSettings(settings, kind);

  return {
    questionCount: configuration.questionCount,
    choiceCount: settings.choiceCount,
    questionKind:
      kind === 'quiz' ? (settings.questionKind === 'all' ? 'mixed' : settings.questionKind) : kind,
    difficulty: configuration.difficulty
  } as const;
}

function useExamOpening(opened: (opening: ExamOpening) => void, track: TrackExamRequest) {
  const [topic, setTopic] = useState('');
  const exam = useWrittenExamRequest(track);
  const startExam = async (request: Pick<WrittenExamInput, 'projectId' | 'inputs'>) => {
    const focus = topic.trim();
    const step = { kind: 'start' as const, ...(focus ? { topic: focus } : {}) };
    const result = await exam.run({ ...request, step });

    if (result?.kind === 'opening')
      opened({ ...request, concept: result.concept, question: result.question });
  };

  return {
    ...exam,
    topic,
    startExam,
    changeTopic: (value: string) => {
      exam.reset();
      setTopic(value);
    }
  };
}

/** Build document-grounded requests using the selected practice format. */
function useGeneration(
  projectId: ProjectId | undefined,
  accepted: (id: string) => void,
  examOpened: (opening: ExamOpening) => void,
  trackRequest: TrackExamRequest
) {
  const { t } = useI18n();
  const [kind, setKind] = useState<GenerationKind>('quiz');
  const submission = useDictationSubmission();
  const [instruction, setInstruction] = useState('');
  const { pages, inputs, setInputs } = useGenerationPages(projectId);
  const isExam = kind === 'exam';
  const readiness = useAiReadiness('medium', isExam ? 'chatgpt' : undefined);
  const preferences = rpc.settings.quizSettings.useQuery({}, { enabled: !isExam });
  const exam = useExamOpening(examOpened, trackRequest);
  const start = useNativeAction(async (input: typeof materialGenerationInputSchema.Type) => {
    const result = await rpc.materials.requestMaterialGeneration.call(input);

    accepted(result.id);

    return result;
  });
  const busy = start.isPending || exam.isPending;
  const option = generationKinds.find((entry) => entry.kind === kind)!;
  const canStart =
    readiness === 'ready' &&
    !busy &&
    pages.isSuccess &&
    inputs.length > 0 &&
    inputs.length <= 20 &&
    (isExam || preferences.isSuccess);

  const create = () => {
    if (!canStart || projectId === undefined || submission.isBlocked()) return;

    const selected = inputs.filter((input) => input.kind === 'page');

    if (kind === 'exam') {
      const [first, ...rest] = selected;

      if (first) void exam.startExam({ projectId, inputs: [first, ...rest] });

      return;
    }

    start.mutate({
      projectId,
      title: t(option.label),
      autoTitle: true,
      kind: kind === 'flashcards' ? 'flashcards' : 'quiz',
      instruction: instruction.trim() || undefined,
      inputs: selected,
      quizConfig: quizConfiguration(kind, preferences.data ?? defaultQuizSettings)
    });
  };

  return {
    readiness,
    kind,
    setKind,
    option,
    instruction,
    setInstruction,
    pages,
    inputs,
    setInputs,
    preferences,
    start,
    exam,
    isExam,
    busy,
    canStart,
    submission,
    create
  };
}

type GenerationModel = ReturnType<typeof useGeneration>;

/** Offer localized practice modes alongside the selected source pages. */
function GenerationPanel({
  projectId,
  accepted,
  examOpened,
  trackRequest
}: {
  projectId?: ProjectId;
  accepted: (id: string) => void;
  examOpened: (opening: ExamOpening) => void;
  trackRequest: TrackExamRequest;
}) {
  const { t } = useI18n();
  const model = useGeneration(projectId, accepted, examOpened, trackRequest);
  const topicId = useId();

  return (
    <>
      <Practice.GenerationLayout>
        <Practice.GenerationBrief>
          <Settings.Section title={t('PracticeGenerateKind')}>
            <Settings.ChoiceGroup label={t('PracticeGenerateKind')}>
              {generationKinds.map(({ kind, label, icon: Icon }) => (
                <Settings.Choice
                  key={kind}
                  label={t(label)}
                  selected={model.kind === kind}
                  disabled={model.busy}
                  onSelect={() => model.setKind(kind)}
                >
                  <Icon aria-hidden="true" />
                </Settings.Choice>
              ))}
            </Settings.ChoiceGroup>
            {model.option.help && <Settings.Intro>{t(model.option.help)}</Settings.Intro>}
          </Settings.Section>
          {model.isExam ? (
            <Settings.Section>
              <Label htmlFor={topicId}>{t('WrittenExamTopic')}</Label>
              <Input
                id={topicId}
                value={model.exam.topic}
                maxLength={writtenExamTopicLimit}
                placeholder={t('WrittenExamTopicHint')}
                disabled={model.busy}
                onChange={(event) => model.exam.changeTopic(event.target.value)}
              />
            </Settings.Section>
          ) : (
            <GenerationInstructions model={model} projectId={projectId} />
          )}
        </Practice.GenerationBrief>
        <Practice.GenerationPages>
          <QuizInputPicker
            pages={model.pages}
            inputs={model.inputs}
            onChange={(update) => {
              model.exam.reset();
              model.setInputs(update);
            }}
            disabled={model.busy}
          />
        </Practice.GenerationPages>
      </Practice.GenerationLayout>
      <Practice.GenerationStatus>
        <AiReadinessNotice
          state={model.readiness}
          setupLabel={model.isExam ? t('WrittenExamChatGptSetup') : undefined}
        />
        <GenerationStatus model={model} />
      </Practice.GenerationStatus>
      <DialogFooter>
        <DialogDismissButton label={t('Close')} disabled={model.exam.isPending} />
        <GenerationAction model={model} />
      </DialogFooter>
    </>
  );
}

function GenerationInstructions({
  model,
  projectId
}: {
  model: GenerationModel;
  projectId?: ProjectId;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Practice.Customize onToggle={(event) => setOpen(event.currentTarget.open)}>
      <Practice.CustomizeSummary>
        <OptionsIcon aria-hidden="true" />
        <span>{t('PracticeCustomize')}</span>
        <ExpandIcon aria-hidden="true" />
      </Practice.CustomizeSummary>
      <Practice.CustomizeBody>
        <DictationSubmissionScope value={model.submission.scope}>
          <DictationTextarea
            targetKey={`${projectId}:${model.kind}`}
            toolbarLabel={t('PracticeGeneratePrompt')}
            placeholder={t('PracticeGeneratePromptHint')}
            value={model.instruction}
            maxLength={100000}
            disabled={model.busy || !open}
            onValueChange={model.setInstruction}
          />
        </DictationSubmissionScope>
        <Settings.Intro>{t('PracticeGenerateAutomaticTitle')}</Settings.Intro>
      </Practice.CustomizeBody>
    </Practice.Customize>
  );
}

function GenerationStatus({ model }: { model: GenerationModel }) {
  const { t } = useI18n();

  return (
    <>
      {model.inputs.length > 20 && (
        <Settings.Feedback role="status">{t('PracticeGenerateLimit')}</Settings.Feedback>
      )}
      {model.isExam && model.exam.data?.kind === 'unavailable' && (
        <Settings.Feedback role="status">{t('WrittenExamUnsupported')}</Settings.Feedback>
      )}
      {hasGenerationError(model) && (
        <ErrorState
          layout="inline"
          title={t(model.isExam ? 'WrittenExamStartError' : 'QuizGenerateError')}
          action={
            <RetryButton
              variant="outline"
              size="sm"
              disabled={model.submission.blocked && (model.isExam || !model.preferences.isError)}
              onClick={() => {
                if (!model.isExam && model.preferences.isError) void model.preferences.refetch();
                else model.create();
              }}
              label={t('Retry')}
            />
          }
        />
      )}
    </>
  );
}

function hasGenerationError(model: GenerationModel) {
  return model.isExam ? model.exam.isError : model.preferences.isError || model.start.isError;
}

function GenerationAction({ model }: { model: GenerationModel }) {
  const { t } = useI18n();
  const label = t(model.isExam ? 'WrittenExamStart' : 'PracticeGenerateStart');

  return (
    <AiButton
      tier="medium"
      provider={model.isExam ? 'chatgpt' : undefined}
      label={label}
      workingLabel={t(model.isExam ? 'WrittenExamStarting' : 'QuizGenerating')}
      pending={model.busy}
      disabled={!model.canStart || model.submission.blocked}
      onClick={model.create}
    >
      {model.isExam && model.busy ? t('WrittenExamStarting') : label}
    </AiButton>
  );
}

function useGenerationPages(projectId?: ProjectId) {
  const pagination = useCursorWindow<PageId>(String(projectId ?? 'global'));
  const query = rpc.pages.list.useQuery({
    projectId,
    limit: pagination.limit,
    cursor: pagination.cursor,
    archived: false
  });

  useCursorRecovery(pagination, query.error);
  const pages = { ...query, pagination };
  const [excluded, setExcluded] = useState<bigint[]>([]);
  const inputs: ContentInput[] = (pages.data?.items ?? [])
    .filter((doc) => doc.headVersionId !== null && !excluded.includes(doc.headVersionId))
    .map((doc) => ({ kind: 'page', versionId: doc.headVersionId! }));
  const setInputs = (update: SetStateAction<ContentInput[]>) => {
    const next = typeof update === 'function' ? update(inputs) : update;
    const selected = new Set(
      next.filter((input) => input.kind === 'page').map((input) => input.versionId)
    );

    setExcluded(
      (pages.data?.items ?? []).flatMap((doc) =>
        doc.headVersionId !== null && !selected.has(doc.headVersionId) ? [doc.headVersionId] : []
      )
    );
  };

  return { pages, inputs, setInputs };
}
