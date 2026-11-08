import type { PageId, PageVersionId } from '@study/contracts/ids';
import type { Page, PageVersion } from '@study/contracts/pages/types';
import { Loading } from '@study/ui/loading';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useQuery } from '@tanstack/react-query';
import { Check, Cloud, CloudOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { pageVersionOptions } from '#web/lib/study-client/pages.queries.ts';

import { CanonicalDocumentEditor } from './canonical-document-editor';
import { PageMetadata } from './note-page-metadata';
import { notePageOptions, useNotePageAutosave } from './note-page.queries';
import { SaveRecoveryNotice } from './save-recovery';
import { NoteReadError } from './status';

type EditorActions = {
  actions?: (page: Page, version: PageVersion, disabled: boolean) => ReactNode;
  versionId?: PageVersionId;
};

export function NotePagePanel({ pageId, actions, versionId }: { pageId: PageId } & EditorActions) {
  const { t } = useI18n();
  const state = useQuery(notePageOptions(pageId));

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.error) return <NoteReadError error={state.error} retry={() => void state.refetch()} />;

  if (!state.data) return null;

  return state.data.version ? (
    <PageEditor page={state.data} actions={actions} versionId={versionId} />
  ) : (
    <Desk.Recovery>
      <p>{t('NoteReadUnavailable')}</p>
    </Desk.Recovery>
  );
}

function PageEditor({ page, actions, versionId }: { page: Page } & EditorActions) {
  const model = useNotePageAutosave(page);
  const { historical, exact, version, unavailable } = useViewedPage(page, versionId);
  const blocked = model.dirty || model.pending || model.error !== undefined;

  return (
    <>
      <PageRecovery model={model} historical={historical} exact={exact} unavailable={unavailable} />
      {version !== undefined && (
        <Desk.Editor>
          <CanonicalDocumentEditor
            document={historical ? version.document : model.document}
            disabled={historical || exact.isFetching}
            snapshotId={version.snapshotId}
            projectId={page.projectIds[0]}
            onChange={model.change}
            toolbarEnd={
              <>
                <PageSaveStatus model={model} />
                <PageMetadata page={page} />
                {actions?.(page, version, blocked || exact.isFetching)}
              </>
            }
          />
        </Desk.Editor>
      )}
    </>
  );
}

function useViewedPage(page: Page, versionId?: PageVersionId) {
  const historical = versionId !== undefined && versionId !== page.headVersionId;
  const exact = useQuery({ ...pageVersionOptions(versionId!), enabled: historical });
  const candidate = historical ? exact.data : page.version;
  const version = candidate?.pageId === page.id ? candidate : undefined;

  return { historical, exact, version, unavailable: historical && exact.isSuccess && !version };
}

function PageSaveStatus({ model }: { model: ReturnType<typeof useNotePageAutosave> }) {
  const { t } = useI18n();
  const Icon = model.error ? CloudOff : model.dirty ? Cloud : Check;
  const label = model.pending
    ? 'NoteAutosaving'
    : model.dirty
      ? 'NoteAutosavePending'
      : 'NoteAutosaved';

  return (
    <Desk.SaveStatus role="status">
      <Icon size={14} />
      {t(label)}
    </Desk.SaveStatus>
  );
}

function PageRecovery({
  model,
  historical,
  exact,
  unavailable
}: {
  model: ReturnType<typeof useNotePageAutosave>;
} & Omit<ReturnType<typeof useViewedPage>, 'version'>) {
  const { t } = useI18n();

  return (
    <>
      {model.error !== undefined && (
        <Desk.Recovery>
          <SaveRecoveryNotice
            conflict={!!model.conflict}
            onAccept={model.acceptSavedVersion}
            onRetry={() => void model.save()}
          />
        </Desk.Recovery>
      )}
      {historical && exact.error && (
        <NoteReadError error={exact.error} retry={() => void exact.refetch()} />
      )}
      {historical && exact.isPending && <Loading label={t('LoadingStudy')} />}
      {unavailable && (
        <Desk.Recovery>
          <p>{t('ReaderUnavailable')}</p>
        </Desk.Recovery>
      )}
    </>
  );
}
