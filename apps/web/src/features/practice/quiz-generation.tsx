import type { ProjectId } from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { defaultQuizSettings } from '@study/contracts/settings/types';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Plus } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { versionOptions } from '#web/lib/study-client/materials.queries.ts';
import { quizSettingsOptions } from '#web/lib/study-client/quiz-settings.queries.ts';

import {
  cancelQuizGenerationOptions,
  quizGenerationOptions,
  quizGenerationMutationOptions
} from './quiz-generation.queries';
import { QuizInputPicker } from './quiz-input-picker';

export function QuizGenerationAction({
  version,
  projectId,
  title
}: {
  version: MaterialVersionDetailDto;
  projectId?: ProjectId;
  title?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Plus aria-hidden="true" />
        {t('QuizGenerateTitle')}
      </DialogTrigger>
      <DialogPopup
        keepMounted
        closeLabel={t('Close')}
        variant="workspace-context"
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>{t('QuizGenerateTitle')}</DialogTitle>
          <DialogDescription>{t('QuizGenerateHelp')}</DialogDescription>
        </DialogHeader>
        <GenerationPanel
          version={version}
          projectId={projectId}
          title={title}
          open={open}
          close={() => setOpen(false)}
        />
      </DialogPopup>
    </Dialog>
  );
}

function useGeneration(version: MaterialVersionDetailDto, projectId?: ProjectId, title?: string) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [name, setName] = useState(title ?? t('QuizGenerateTitle'));
  const preferences = useQuery(quizSettingsOptions());
  const configuration = preferences.data ?? defaultQuizSettings;
  const [inputs, setInputs] = useState<ContentInput[]>(
    version.inputs.filter((input) => input.kind === 'document')
  );
  const [requestId, setRequestId] = useState<string>();
  const generation = useQuery({
    ...quizGenerationOptions(requestId ?? ''),
    enabled: requestId !== undefined
  });
  const start = useMutation({
    ...quizGenerationMutationOptions(),
    onSuccess: (result) => {
      setRequestId(result.id);
      void client.invalidateQueries({ queryKey: ['materials', 'library'] });
    }
  });
  const cancel = useMutation({
    ...cancelQuizGenerationOptions(),
    onSuccess: (result) => client.setQueryData(quizGenerationOptions(result.id).queryKey, result)
  });
  const completed = generation.data?.resultVersionId;
  const cancelled = generation.data?.cancelled === true;
  const failed = generation.data?.errorKind != null;
  const terminal = isTerminal(completed, cancelled, failed);
  const busy = start.isPending || (requestId !== undefined && !terminal);
  const hasSources = projectId !== undefined && inputs.length > 0;
  const create = () => {
    if (projectId && preferences.isSuccess)
      start.mutate({
        projectId,
        title: name.trim(),
        kind: 'quiz',
        inputs: inputs.filter((input) => input.kind === 'document'),
        quizConfig: {
          questionCount: configuration.questionCount,
          choiceCount: configuration.choiceCount,
          questionKind: configuration.questionKind === 'all' ? 'mixed' : configuration.questionKind,
          difficulty: configuration.difficulty
        }
      });
  };

  return {
    name,
    setName,
    inputs,
    setInputs,
    preferences,
    requestId,
    generation,
    start,
    cancel,
    completed,
    cancelled,
    failed,
    busy,
    hasSources,
    create
  };
}

function isTerminal(completed: bigint | null | undefined, cancelled: boolean, failed: boolean) {
  return Boolean(completed) || cancelled || failed;
}

type GenerationModel = ReturnType<typeof useGeneration>;

function GenerationPanel({
  version,
  projectId,
  title,
  close
}: {
  version: MaterialVersionDetailDto;
  projectId?: ProjectId;
  title?: string;
  open: boolean;
  close: () => void;
}) {
  const { t } = useI18n();
  const model = useGeneration(version, projectId, title);

  return (
    <>
      <WorkspaceSurface.ContextDialogBody>
        <WorkspaceSurface.Container>
          <Settings.Group>
            <Settings.Row title={t('QuizGenerateName')}>
              <Input
                aria-label={t('QuizGenerateName')}
                value={model.name}
                maxLength={200}
                disabled={model.busy}
                onValueChange={model.setName}
              />
            </Settings.Row>
          </Settings.Group>
          {projectId && (
            <QuizInputPicker
              projectId={projectId}
              inputs={model.inputs}
              onChange={model.setInputs}
              disabled={model.busy}
            />
          )}
          <GenerationStatus model={model} />
        </WorkspaceSurface.Container>
      </WorkspaceSurface.ContextDialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        <GenerationAction model={model} projectId={projectId} close={close} />
      </DialogFooter>
    </>
  );
}

function GenerationStatus({ model }: { model: GenerationModel }) {
  const { t } = useI18n();

  return (
    <>
      {!model.hasSources && <Settings.Feedback>{t('QuizGenerateNoSources')}</Settings.Feedback>}
      {model.busy && (
        <>
          <Loading label={t('QuizGenerating')} layout="panel" />
          <Settings.Feedback>{t('QuizGeneratingHelp')}</Settings.Feedback>
        </>
      )}
      {model.cancelled && (
        <Settings.Feedback role="status">{t('QuizGenerateCancelled')}</Settings.Feedback>
      )}
      {hasGenerationError(model) && (
        <ErrorState
          layout="inline"
          title={t('QuizGenerateError')}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (model.preferences.isError) void model.preferences.refetch();
                else if (model.failed || !model.requestId) model.create();
                else void model.generation.refetch();
              }}
            >
              {t('Retry')}
            </Button>
          }
        />
      )}
      {model.completed && (
        <Settings.Feedback role="status">{t('QuizGenerateReady')}</Settings.Feedback>
      )}
    </>
  );
}

function hasGenerationError(model: GenerationModel) {
  return (
    model.preferences.isError ||
    model.failed ||
    model.start.isError ||
    model.generation.isError ||
    model.cancel.isError
  );
}

function GenerationAction({
  model,
  projectId,
  close
}: {
  model: GenerationModel;
  projectId?: ProjectId;
  close: () => void;
}) {
  const { t } = useI18n();

  if (model.requestId && model.busy)
    return (
      <Button
        variant="outline"
        disabled={model.cancel.isPending}
        onClick={() => model.requestId && model.cancel.mutate(model.requestId)}
      >
        {t('Cancel')}
      </Button>
    );

  if (model.completed)
    return <GeneratedQuizLink id={model.completed} projectId={projectId} close={close} />;

  return (
    <Button
      disabled={
        !model.hasSources ||
        model.name.trim().length === 0 ||
        model.busy ||
        !model.preferences.isSuccess
      }
      onClick={model.create}
    >
      {t('QuizGenerateStart')}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}

function GeneratedQuizLink({
  id,
  projectId,
  close
}: {
  id: MaterialVersionDetailDto['id'];
  projectId?: ProjectId;
  close: () => void;
}) {
  const { t } = useI18n();
  const version = useQuery(versionOptions(id));
  const client = useQueryClient();

  return (
    <Button
      disabled={!version.data}
      render={
        version.data ? (
          <Link
            to="/practice/$materialId"
            params={{ materialId: String(version.data.material_id) }}
            search={projectId ? { project: String(projectId) } : {}}
            onClick={() => {
              void client.invalidateQueries({ queryKey: ['materials', 'library'] });
              void client.invalidateQueries({ queryKey: ['library', 'practice'] });
              close();
            }}
          />
        ) : undefined
      }
    >
      {t('QuizOpenGenerated')}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}
