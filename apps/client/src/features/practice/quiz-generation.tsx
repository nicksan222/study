import { defaultQuizSettings, practiceGenerationSettings } from '@study/contracts';
import type {
  PageId,
  ProjectId,
  ContentInput,
  materialGenerationInputSchema,
  MaterialVersionDetailDto
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
  TrueFalseIcon
} from '@study/icons';
import {
  RetryButton,
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogFooter,
  DialogDismissButton,
  DialogHeading,
  ErrorState,
  Practice,
  Settings
} from '@study/ui';
import type { SetStateAction } from 'react';
import { useState, useCallback } from 'react';

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
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<string[]>([]);
  const settled = useCallback(
    (id: string) => setRequests((current) => current.filter((request) => request !== id)),
    []
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <AiButton
            tier="medium"
            size={inline ? 'default' : 'icon'}
            variant={inline ? 'outline' : 'ghost-muted'}
            label={t(inline ? 'PracticeGenerateFromPages' : 'PracticeGenerate')}
            disabled={disabled || projectId === undefined}
            disabledReason={projectId === undefined ? t('PracticeChooseSubject') : undefined}
            pending={requests.length > 0}
            workingLabel={t('QuizGenerating')}
          >
            {inline && t('PracticeGenerateFromPages')}
          </AiButton>
        }
      />
      <DialogPopup
        keepMounted
        closeLabel={t('Close')}
        variant="practice-generation"
        bottomStickOnMobile={false}
      >
        <DialogHeading
          title={<> {t('PracticeGenerate')} </>}
          description={<> {t('PracticeGenerateHelp')} </>}
        />
        {open && (
          <GenerationPanel
            projectId={projectId}
            accepted={(id) => {
              setRequests((current) => [...current, id]);
              setOpen(false);
            }}
          />
        )}
      </DialogPopup>
      {requests.map((id) => (
        <GenerationWatcher key={id} id={id} settled={settled} />
      ))}
    </Dialog>
  );
}

/** Build document-grounded generation requests using the selected kind and saved preferences. */
function useGeneration(projectId: ProjectId | undefined, accepted: (id: string) => void) {
  const { t } = useI18n();
  const readiness = useAiReadiness('medium');
  const submission = useDictationSubmission();
  const [kind, setKind] = useState<
    'quiz' | 'flashcards' | 'fill_blank' | 'matching' | 'true_false' | 'ordering'
  >('quiz');
  const [instruction, setInstruction] = useState('');
  const { pages, inputs, setInputs } = useGenerationPages(projectId);
  const preferences = rpc.settings.quizSettings.useQuery({});
  const saved = preferences.data ?? defaultQuizSettings;
  const configuration =
    kind === 'quiz' || kind === 'flashcards'
      ? saved
      : { ...saved, ...practiceGenerationSettings(saved, kind) };
  const start = useNativeAction(async (input: typeof materialGenerationInputSchema.Type) => {
    const result = await rpc.materials.requestMaterialGeneration.call(input);

    accepted(result.id);

    return result;
  });
  const busy = start.isPending;
  const hasSources = pages.isSuccess && inputs.length > 0 && inputs.length <= 20;
  const titleKey = {
    quiz: 'SidebarQuiz',
    flashcards: 'Flashcards',
    ordering: 'PracticeOrdering',
    fill_blank: 'PracticeFillBlank',
    matching: 'PracticeMatching',
    true_false: 'PracticeTrueFalse'
  } as const;
  const configuredQuestionKind =
    configuration.questionKind === 'all' ? 'mixed' : configuration.questionKind;
  const questionKind = kind !== 'quiz' && kind !== 'flashcards' ? kind : configuredQuestionKind;
  /** Starts generation after sources and preferences are ready; specialized practice remains a quiz material. */
  const create = () => {
    if (submission.isBlocked()) return;

    if (readiness === 'ready' && projectId !== undefined && hasSources && preferences.isSuccess)
      start.mutate({
        projectId,
        title: t(titleKey[kind]),
        autoTitle: true,
        kind: kind === 'flashcards' ? 'flashcards' : 'quiz',
        instruction: instruction.trim() || undefined,
        inputs: inputs.filter((input) => input.kind === 'page'),
        quizConfig:
          kind !== 'flashcards'
            ? {
                questionCount: configuration.questionCount,
                choiceCount: configuration.choiceCount,
                questionKind,
                difficulty: configuration.difficulty
              }
            : undefined
      });
  };

  return {
    readiness,
    kind,
    setKind,
    instruction,
    setInstruction,
    pages,
    inputs,
    setInputs,
    preferences,
    start,
    busy,
    hasSources,
    submission,
    create
  };
}

type GenerationModel = ReturnType<typeof useGeneration>;

/** Offer localized practice modes alongside the selected source pages. */
function GenerationPanel({
  projectId,
  accepted
}: {
  projectId?: ProjectId;
  accepted: (id: string) => void;
}) {
  const { t } = useI18n();
  const model = useGeneration(projectId, accepted);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  return (
    <>
      <Practice.GenerationLayout>
        <Practice.GenerationBrief>
          <Settings.Section title={t('PracticeGenerateKind')}>
            <Settings.ChoiceGroup label={t('PracticeGenerateKind')}>
              <Settings.Choice
                label={t('SidebarQuiz')}
                selected={model.kind === 'quiz'}
                disabled={model.busy}
                onSelect={() => model.setKind('quiz')}
              >
                <QuizIcon aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('Flashcards')}
                selected={model.kind === 'flashcards'}
                disabled={model.busy}
                onSelect={() => model.setKind('flashcards')}
              >
                <FlashcardsIcon aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeFillBlank')}
                selected={model.kind === 'fill_blank'}
                disabled={model.busy}
                onSelect={() => model.setKind('fill_blank')}
              >
                <FillBlankIcon aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeOrdering')}
                selected={model.kind === 'ordering'}
                disabled={model.busy}
                onSelect={() => model.setKind('ordering')}
              >
                <OrderingIcon aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeMatching')}
                selected={model.kind === 'matching'}
                disabled={model.busy}
                onSelect={() => model.setKind('matching')}
              >
                <MatchingIcon aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeTrueFalse')}
                selected={model.kind === 'true_false'}
                disabled={model.busy}
                onSelect={() => model.setKind('true_false')}
              >
                <TrueFalseIcon aria-hidden="true" />
              </Settings.Choice>
            </Settings.ChoiceGroup>
            {model.kind === 'matching' && (
              <Settings.Intro>{t('PracticeMatchingHelp')}</Settings.Intro>
            )}
            {model.kind === 'ordering' && (
              <Settings.Intro>{t('PracticeOrderingHelp')}</Settings.Intro>
            )}
            {model.kind === 'fill_blank' && (
              <Settings.Intro>{t('PracticeFillBlankHelp')}</Settings.Intro>
            )}
            {model.kind === 'true_false' && (
              <Settings.Intro>{t('PracticeTrueFalseHelp')}</Settings.Intro>
            )}
          </Settings.Section>
          <Practice.Customize onToggle={(event) => setCustomizeOpen(event.currentTarget.open)}>
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
                  disabled={model.busy || !customizeOpen}
                  onValueChange={model.setInstruction}
                />
              </DictationSubmissionScope>
              <Settings.Intro>{t('PracticeGenerateAutomaticTitle')}</Settings.Intro>
            </Practice.CustomizeBody>
          </Practice.Customize>
        </Practice.GenerationBrief>
        <Practice.GenerationPages>
          <QuizInputPicker
            pages={model.pages}
            inputs={model.inputs}
            onChange={model.setInputs}
            disabled={model.busy}
          />
        </Practice.GenerationPages>
      </Practice.GenerationLayout>
      <Practice.GenerationStatus>
        <AiReadinessNotice state={model.readiness} />
        <GenerationStatus model={model} />
      </Practice.GenerationStatus>
      <DialogFooter>
        <DialogDismissButton label={t('Close')} />
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
      {hasGenerationError(model) && (
        <ErrorState
          layout="inline"
          title={t('QuizGenerateError')}
          action={
            <RetryButton
              variant="outline"
              size="sm"
              onClick={() => {
                if (model.preferences.isError) void model.preferences.refetch();
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
  return model.preferences.isError || model.start.isError;
}

function GenerationAction({ model }: { model: GenerationModel }) {
  const { t } = useI18n();

  return (
    <AiButton
      tier="medium"
      label={t('PracticeGenerateStart')}
      workingLabel={t('QuizGenerating')}
      pending={model.busy}
      disabled={
        model.readiness !== 'ready' ||
        !model.hasSources ||
        model.busy ||
        model.submission.blocked ||
        !model.preferences.isSuccess
      }
      onClick={model.create}
    >
      {t('PracticeGenerateStart')}
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
