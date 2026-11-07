import type { ProjectId } from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { defaultQuizSettings, practiceGenerationSettings } from '@study/contracts/settings/types';
import { RetryButton } from '@study/ui/action-button';
import { AiButton } from '@study/ui/ai-button';
import { Dialog, DialogTrigger, DialogPopup, DialogFooter } from '@study/ui/dialog';
import { DialogDismissButton } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { ErrorState } from '@study/ui/error-state';
import { Practice } from '@study/ui/practice';
import { Settings } from '@study/ui/settings';
import { Textarea } from '@study/ui/textarea';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link2,
  GraduationCap,
  Layers,
  SlidersHorizontal,
  ChevronDown,
  ListOrdered,
  TextCursorInput,
  Binary
} from 'lucide-react';
import type { SetStateAction } from 'react';
import { useState, useCallback } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { quizSettingsOptions } from '#web/lib/study-client/quiz-settings.queries.ts';

import { GenerationWatcher } from './generation-watcher';
import {
  generationDocumentsOptions,
  quizGenerationMutationOptions
} from './quiz-generation.queries';
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
            size={inline ? 'default' : 'icon'}
            variant={inline ? 'outline' : 'ghost-muted'}
            label={t(inline ? 'PracticeGenerateFromDocuments' : 'PracticeGenerate')}
            disabled={disabled}
            pending={requests.length > 0}
            workingLabel={t('QuizGenerating')}
          >
            {inline && t('PracticeGenerateFromDocuments')}
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
  const client = useQueryClient();
  const [kind, setKind] = useState<
    'quiz' | 'flashcards' | 'fill_blank' | 'matching' | 'true_false' | 'ordering'
  >('quiz');
  const [instruction, setInstruction] = useState('');
  const { documents, inputs, setInputs } = useGenerationDocuments(projectId);
  const preferences = useQuery(quizSettingsOptions());
  const saved = preferences.data ?? defaultQuizSettings;
  const configuration =
    kind === 'quiz' || kind === 'flashcards'
      ? saved
      : { ...saved, ...practiceGenerationSettings(saved, kind) };
  const start = useMutation({
    ...quizGenerationMutationOptions(),
    onSuccess: (result) => {
      accepted(result.id);
      void client.invalidateQueries({ queryKey: ['materials', 'active-generations'] });
    }
  });
  const busy = start.isPending;
  const hasSources = documents.isSuccess && inputs.length > 0 && inputs.length <= 20;
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
    if (hasSources && preferences.isSuccess)
      start.mutate({
        projectId,
        title: t(titleKey[kind]),
        autoTitle: true,
        kind: kind === 'flashcards' ? 'flashcards' : 'quiz',
        instruction: instruction.trim() || undefined,
        inputs: inputs.filter((input) => input.kind === 'document'),
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
    kind,
    setKind,
    instruction,
    setInstruction,
    documents,
    inputs,
    setInputs,
    preferences,
    start,
    busy,
    hasSources,
    create
  };
}

type GenerationModel = ReturnType<typeof useGeneration>;

/** Offer localized practice modes alongside the selected source documents. */
function GenerationPanel({
  projectId,
  accepted
}: {
  projectId?: ProjectId;
  accepted: (id: string) => void;
}) {
  const { t } = useI18n();
  const model = useGeneration(projectId, accepted);

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
                <GraduationCap aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('Flashcards')}
                selected={model.kind === 'flashcards'}
                disabled={model.busy}
                onSelect={() => model.setKind('flashcards')}
              >
                <Layers aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeFillBlank')}
                selected={model.kind === 'fill_blank'}
                disabled={model.busy}
                onSelect={() => model.setKind('fill_blank')}
              >
                <TextCursorInput aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeOrdering')}
                selected={model.kind === 'ordering'}
                disabled={model.busy}
                onSelect={() => model.setKind('ordering')}
              >
                <ListOrdered aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeMatching')}
                selected={model.kind === 'matching'}
                disabled={model.busy}
                onSelect={() => model.setKind('matching')}
              >
                <Link2 aria-hidden="true" />
              </Settings.Choice>
              <Settings.Choice
                label={t('PracticeTrueFalse')}
                selected={model.kind === 'true_false'}
                disabled={model.busy}
                onSelect={() => model.setKind('true_false')}
              >
                <Binary aria-hidden="true" />
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
          <Practice.Customize>
            <Practice.CustomizeSummary>
              <SlidersHorizontal aria-hidden="true" />
              <span>{t('PracticeCustomize')}</span>
              <ChevronDown aria-hidden="true" />
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
        </Practice.GenerationBrief>
        <Practice.GenerationDocuments>
          <QuizInputPicker
            documents={model.documents}
            inputs={model.inputs}
            onChange={model.setInputs}
            disabled={model.busy}
          />
        </Practice.GenerationDocuments>
      </Practice.GenerationLayout>
      <Practice.GenerationStatus>
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
      label={t('PracticeGenerateStart')}
      workingLabel={t('QuizGenerating')}
      pending={model.busy}
      disabled={!model.hasSources || model.busy || !model.preferences.isSuccess}
      onClick={model.create}
    >
      {t('PracticeGenerateStart')}
    </AiButton>
  );
}

function useGenerationDocuments(projectId?: ProjectId) {
  const documents = useQuery(generationDocumentsOptions(projectId));
  const [excluded, setExcluded] = useState<bigint[]>([]);
  const inputs: ContentInput[] = (documents.data ?? [])
    .filter((doc) => doc.headVersionId !== null && !excluded.includes(doc.headVersionId))
    .map((doc) => ({ kind: 'document', versionId: doc.headVersionId! }));
  const setInputs = (update: SetStateAction<ContentInput[]>) => {
    const next = typeof update === 'function' ? update(inputs) : update;
    const selected = new Set(
      next.filter((input) => input.kind === 'document').map((input) => input.versionId)
    );

    setExcluded(
      (documents.data ?? []).flatMap((doc) =>
        doc.headVersionId !== null && !selected.has(doc.headVersionId) ? [doc.headVersionId] : []
      )
    );
  };

  return { documents, inputs, setInputs };
}
