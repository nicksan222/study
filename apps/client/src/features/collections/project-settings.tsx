import { StudyError } from '@study/contracts';
import type { ProjectId, Project } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  RetryButton,
  Button,
  DangerDialog,
  ErrorState,
  IdentityEditor,
  Input,
  Loading,
  PreviousButton,
  Settings,
  SubjectSettings,
  toastManager
} from '@study/ui';
import { useState } from 'react';

import {
  useCursorRecovery,
  useCursorWindow,
  CursorWindowActions
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { SubjectIconEditor, SubjectIdentity, useSubjectIconPending } from '../subjects';
import { useCollectionState, validCollectionName } from './collection-state.queries';

type Editor = ReturnType<typeof useCollectionState>;

/** Opens the subjects index or an explicitly selected subject without changing workspace scope. */
export function ProjectSettings({
  initialProject,
  onDeleted
}: {
  initialProject?: ProjectId;
  onDeleted?: (id: ProjectId) => void;
}) {
  const { t } = useI18n();
  const window = useCursorWindow<ProjectId>('project-settings');
  const projects = rpc.projects.list.useQuery({ limit: window.limit, before: window.cursor });

  useCursorRecovery(window, projects.error);
  const [selected, setSelected] = useState(initialProject);
  const editor = useCollectionState();
  const iconPending = useSubjectIconPending(selected);
  const busy = editor.state.pending || iconPending;
  const items = projects.data?.items ?? [];
  const selectedProject = rpc.projects.get.useQuery(
    selected === undefined ? undefined : { id: selected }
  );
  const project = selectedProject.data ?? items.find((item) => item.id === selected);

  if (project) {
    return (
      <>
        <Settings.Section
          title={project.name}
          actions={
            <PreviousButton
              variant="ghost-muted"
              size="sm"
              onClick={() => setSelected(undefined)}
              label={t('Projects')}
            ></PreviousButton>
          }
        >
          <ProjectDetails
            project={project}
            editor={editor}
            busy={busy}
            onDeleted={() => {
              setSelected(undefined);
              onDeleted?.(project.id);
            }}
          />
        </Settings.Section>
      </>
    );
  }

  return <ProjectIndex projects={projects} navigation={window} select={setSelected} />;
}

function ProjectIndex({
  projects,
  navigation,
  select
}: {
  projects: ReturnType<typeof rpc.projects.list.useQuery>;
  navigation: ReturnType<typeof useCursorWindow<ProjectId>>;
  select: (id: ProjectId) => void;
}) {
  const { t } = useI18n();
  const items = projects.data?.items ?? [];

  return (
    <Settings.Section title={t('ProjectSettingsTitle')}>
      {projects.isPending && <Loading label={t('LoadingSubjects')} />}
      {projects.isError && (
        <ErrorState
          layout="inline"
          title={t('SubjectsLoadError')}
          action={
            <RetryButton
              variant="outline"
              onClick={() => void projects.refetch()}
              label={t('Retry')}
            />
          }
        />
      )}
      <CursorWindowActions
        {...navigation}
        hasMore={!!projects.data?.next}
        pending={projects.isFetching}
        more={() => navigation.more(projects.data?.next)}
      />
      {projects.isSuccess && !items.length && <Settings.Empty>{t('NoProjectsYet')}</Settings.Empty>}
      {!!items.length && (
        <>
          <SubjectSettings.Introduction>
            {t('ProjectSettingsIndexHelp')}
          </SubjectSettings.Introduction>
          <Settings.Group>
            {items.map((item) => (
              <Settings.Item
                key={String(item.id)}
                label={item.name}
                icon={<SubjectIdentity name={item.name} icon={item.icon} />}
                onClick={() => select(item.id)}
              />
            ))}
          </Settings.Group>
        </>
      )}
    </Settings.Section>
  );
}

export function SubjectManagement({
  project,
  onDeleted
}: {
  project: Project;
  onDeleted: () => void;
}) {
  const editor = useCollectionState();
  const iconPending = useSubjectIconPending(project.id);

  return (
    <ProjectDetails
      project={project}
      editor={editor}
      busy={editor.state.pending || iconPending}
      onDeleted={onDeleted}
    />
  );
}

/** Keeps rename drafts bound to their subject and acknowledges only the submitted revision. */
function ProjectDetails({
  project,
  editor,
  busy,
  onDeleted
}: {
  project: Project;
  editor: Editor;
  busy: boolean;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const { state, changeName, acceptName, mutate } = editor;
  const entry = state.names[String(project.id)];
  const name = entry?.text ?? project.name;

  async function rename() {
    if (busy || !validCollectionName(name)) return;

    await mutate(async () => {
      const changed = await rpc.projects.rename.call({ id: project.id, name: name.trim() });

      if (!changed) throw new StudyError('not_found', 'Subject no longer exists');

      acceptName(project.id, entry?.revision);
      toastManager.add({ title: t('ProjectSettingsSaved'), type: 'success' });
    });
  }

  return (
    <>
      <Settings.Section title={t('ProjectSettingsDetails')}>
        <Settings.Group>
          <Settings.Row title={t('ProjectName')} description={t('ProjectSettingsNameHelp')}>
            <SubjectSettings.NameForm
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <Input
                aria-label={t('ProjectName')}
                value={name}
                maxLength={200}
                onChange={(event) => {
                  changeName(project.id, event.target.value);
                }}
              />
              <Button
                variant="outline"
                type="submit"
                disabled={busy || name.trim() === project.name || !validCollectionName(name)}
              >
                {t('Save')}
              </Button>
            </SubjectSettings.NameForm>
          </Settings.Row>
          <Settings.Row title={t('SubjectIconTitle')} description={t('ProjectSettingsIconHelp')}>
            <IdentityEditor.Preview>
              <SubjectIdentity name={project.name} icon={project.icon} />
              <SubjectIconEditor project={project} disabled={busy} />
            </IdentityEditor.Preview>
          </Settings.Row>
        </Settings.Group>
        {state.error && (
          <ErrorState
            layout="inline"
            title={t('ErrorStateTitle')}
            description={t('collections.mutationError')}
          />
        )}
      </Settings.Section>
      <ProjectRemoval project={project} editor={editor} busy={busy} onDeleted={onDeleted} />
    </>
  );
}

/** Requires the current subject name before removing memberships while retaining independent content. */
function ProjectRemoval({
  project,
  editor,
  busy,
  onDeleted
}: {
  project: Project;
  editor: Editor;
  busy: boolean;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Settings.Section title={t('ProjectSettingsDanger')}>
      <Settings.Group>
        <Settings.Row
          title={t('ProjectSettingsDelete')}
          description={t('ProjectSettingsDeleteHelp')}
        >
          <Button variant="destructive-outline" disabled={busy} onClick={() => setOpen(true)}>
            {t('ProjectSettingsDelete')}
          </Button>
        </Settings.Row>
      </Settings.Group>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title={t('ProjectSettingsDelete')}
        description={t('ProjectSettingsDeleteHelp')}
        confirmation={{
          value: project.name,
          label: `${t('ProjectSettingsConfirmName')}: ${project.name}`,
          identity: String(project.id)
        }}
        confirmLabel={t('ProjectSettingsDelete')}
        cancelLabel={t('Cancel')}
        pending={busy}
        onConfirm={() => {
          if (busy) return;

          return editor.mutate(async () => {
            const deleted = await rpc.projects.delete.call({ id: project.id });

            if (!deleted) throw new StudyError('not_found', 'Subject no longer exists');

            setOpen(false);
            onDeleted();
            toastManager.add({ title: t('SubjectDeleted'), type: 'success' });
          });
        }}
      >
        {editor.state.error && (
          <ErrorState
            layout="inline"
            title={t('ErrorStateTitle')}
            description={t('collections.mutationError')}
          />
        )}
      </DangerDialog>
    </Settings.Section>
  );
}
