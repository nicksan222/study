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
  Settings,
  Textarea
} from '@study/ui';
import { useNavigate } from '@tanstack/react-router';
import type { SetStateAction } from 'react';
import { useState, useCallback, useId, useRef } from 'react';

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
import { ExamExitConfirmation, WrittenExamSession } from './written-exam-session';
import type { ExamOpening } from './written-exam-session';

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
  return <GenerationDialog key={String(projectId)} projectId={projectId} disabled={disabled} />;
}

function useGenerationDialog() {
  const [open, setOpen] = useState(false);
  const [exam, setExam] = useState<ExamOpening>();
  const [examComplete, setExamComplete] = useState(false);
  const [exitIntent, setExitIntent] = useState<'leave' | 'settings'>();
  const session = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const instance = session.current;
  const examActive = exam !== undefined && !examComplete;
  const close = () => {
    session.current++;
    request.current?.abort();
    request.current = undefined;
    setOpen(false);
    setExam(undefined);
    setExamComplete(false);
    setExitIntent(undefined);
  };
  const openExam = (value: ExamOpening) => {
    if (session.current === instance) setExam(value);
  };
  const completeExam = () => {
    if (session.current !== instance) return;

    setExamComplete(true);
    setExitIntent(undefined);
  };

  const trackRequest = (controller: AbortController | undefined) => {
    if (session.current === instance) request.current = controller;
  };
  const changeOpen = (next: boolean, event: { cancel: () => void }) => {
    if (next) setOpen(true);
    else if (examActive) {
      event.cancel();
      setExitIntent('leave');
    } else close();
  };

  const closeAccepted = () => {
    if (session.current === instance) close();
  };
  const showCloseButton = examActive || !exam;
  const variant = exam ? 'practice-exam' : 'practice-generation';

  return {
    open,
    instance,
    changeOpen,
    trackRequest,
    trigger,
    showCloseButton,
    variant,
    exam,
    examActive,
    close,
    closeAccepted,
    openExam,
    completeExam,
    exitIntent,
    setExitIntent
  } as const;
}

function GenerationDialog({
  projectId,
  inline = false,
  disabled
}: {
  projectId?: ProjectId;
  title?: string;
  inline?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const action = inline ? 'PracticeGenerateFromPages' : 'PracticeGenerate';
  const dialog = useGenerationDialog();
  const [requests, setRequests] = useState<string[]>([]);
  const settled = useCallback(
    (id: string) => setRequests((current) => current.filter((request) => request !== id)),
    []
  );

  return (
    <Dialog
      open={dialog.open}
      disablePointerDismissal={dialog.examActive}
      onOpenChange={dialog.changeOpen}
    >
      <DialogTrigger
        render={
          <AiButton
            ref={dialog.trigger}
            tier="medium"
            provider="configured-or-chatgpt"
            size={inline ? 'default' : 'icon'}
            variant={inline ? 'outline' : 'ghost-muted'}
            label={t(action)}
            disabled={disabled || projectId === undefined}
            disabledReason={projectId === undefined ? t('PracticeChooseSubject') : undefined}
            pending={requests.length > 0}
            workingLabel={t('QuizGenerating')}
          >
            {inline && t(action)}
          </AiButton>
        }
      />
      <DialogPopup
        keepMounted
        finalFocus={dialog.trigger}
        closeLabel={t(dialog.examActive ? 'WrittenExamExit' : 'Close')}
        showCloseButton={dialog.showCloseButton}
        variant={dialog.variant}
        bottomStickOnMobile={false}
      >
        {dialog.exam ? (
          <WrittenExamSession
            opening={dialog.exam}
            completed={dialog.completeExam}
            trackRequest={dialog.trackRequest}
            openSettings={() => dialog.setExitIntent('settings')}
            leave={() => dialog.setExitIntent('leave')}
          />
        ) : (
          <>
            <DialogHeading title={t('PracticeGenerate')} description={t('PracticeGenerateHelp')} />
            {dialog.open && (
              <GenerationPanel
                key={dialog.instance}
                projectId={projectId}
                accepted={(id) => {
                  setRequests((current) => [...current, id]);
                  dialog.closeAccepted();
                }}
                examOpened={dialog.openExam}
                trackRequest={dialog.trackRequest}
              />
            )}
          </>
        )}
      </DialogPopup>
      <ExamExitConfirmation
        open={dialog.exitIntent !== undefined}
        onOpenChange={(open) => {
          if (!open) dialog.setExitIntent(undefined);
        }}
        exit={() => {
          dialog.close();

          if (dialog.exitIntent === 'settings') void navigate({ to: '/settings' });
        }}
      />
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
    if (!canStart || projectId === undefined) return;

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
            <Practice.Customize>
              <Practice.CustomizeSummary>
                <OptionsIcon aria-hidden="true" />
                <span>{t('PracticeCustomize')}</span>
                <ExpandIcon aria-hidden="true" />
              </Practice.CustomizeSummary>
              <Practice.CustomizeBody>
                <Settings.Section title={t('PracticeGeneratePrompt')}>
                  <Textarea
                    aria-label={t('PracticeGeneratePrompt')}
                    placeholder={t('PracticeGeneratePromptHint')}
                    value={model.instruction}
                    maxLength={100000}
                    disabled={model.busy}
                    onChange={(event) => model.setInstruction(event.target.value)}
                  />
                </Settings.Section>
                <Settings.Intro>{t('PracticeGenerateAutomaticTitle')}</Settings.Intro>
              </Practice.CustomizeBody>
            </Practice.Customize>
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
      disabled={!model.canStart}
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
