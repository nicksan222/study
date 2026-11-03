import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import type { Project } from '@study/contracts/projects/schemas';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { toastManager } from '@study/ui/toast';
import { useIsMutating, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { projectsQueryOptions } from '../../lib/study-client/study.queries';
import { SubjectIconEditor } from '../subjects/subject-icon-editor';
import { SubjectIdentity } from '../subjects/subject-identity';
import { useCollectionState, validCollectionName } from './collection-state';

type Editor = ReturnType<typeof useCollectionState>;

export function ProjectSettings({
  initialProject,
  onDeleted
}: {
  initialProject?: ProjectId;
  onDeleted?: (id: ProjectId) => void;
}) {
  const { t } = useI18n();
  const projects = useQuery(projectsQueryOptions());
  const [selected, setSelected] = useState(initialProject);
  const editor = useCollectionState();
  const iconPending = useIsMutating({ mutationKey: ['subject-icon'] }) > 0;
  const busy = editor.state.pending || iconPending;
  const items = projects.data ?? [];
  const project = items.find((item) => item.id === selected);
  if (project) {
    return (
      <>
        <Settings.Section
          title={project.name}
          actions={
            <Button variant="ghost-muted" size="sm" onClick={() => setSelected(undefined)}>
              <ArrowLeft aria-hidden="true" />
              {t('Projects')}
            </Button>
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
  return (
    <Settings.Section title={t('ProjectSettingsTitle')}>
      {projects.isPending && <Loading label={t('LoadingSubjects')} />}
      {projects.isError && (
        <ErrorState
          layout="inline"
          title={t('SubjectsLoadError')}
          action={
            <Button variant="outline" onClick={() => void projects.refetch()}>
              {t('Retry')}
            </Button>
          }
        />
      )}
      {projects.isSuccess && !items.length && <Settings.Empty>{t('NoProjectsYet')}</Settings.Empty>}
      {!!items.length && (
        <>
          <p className="mb-4 text-sm text-muted-foreground">{t('ProjectSettingsIndexHelp')}</p>
          <Settings.Group>
            {items.map((item) => (
              <Settings.Item
                key={String(item.id)}
                label={item.name}
                icon={<SubjectIdentity name={item.name} icon={item.icon} />}
                onClick={() => setSelected(item.id)}
              />
            ))}
          </Settings.Group>
        </>
      )}
    </Settings.Section>
  );
}

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
      const changed = await request((client) =>
        client['projects.renameProject']({ id: project.id, name: name.trim() })
      );
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
            <form
              className="flex min-w-0 items-center gap-2"
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
            </form>
          </Settings.Row>
          <Settings.Row title={t('SubjectIconTitle')} description={t('ProjectSettingsIconHelp')}>
            <div className="flex items-center gap-3">
              <SubjectIdentity name={project.name} icon={project.icon} />
              <SubjectIconEditor project={project} disabled={busy} />
            </div>
          </Settings.Row>
        </Settings.Group>
        {state.error && <Settings.Status>{t('collections.mutationError')}</Settings.Status>}
      </Settings.Section>
      <ProjectRemoval project={project} editor={editor} busy={busy} onDeleted={onDeleted} />
    </>
  );
}

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
            const deleted = await request((client) =>
              client['projects.deleteProject']({ id: project.id })
            );
            if (!deleted) throw new StudyError('not_found', 'Subject no longer exists');
            setOpen(false);
            onDeleted();
            toastManager.add({ title: t('SubjectDeleted'), type: 'success' });
          });
        }}
      >
        {editor.state.error && <p role="alert">{t('collections.mutationError')}</p>}
      </DangerDialog>
    </Settings.Section>
  );
}
