import type { SessionId } from '@study/contracts/ids';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { Check, Cloud, CloudOff } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import { Description } from './description';
import { PageDetails } from './history';
import { NoteEditor, NoteContent } from './note-editor';
import { usePageAutosave } from './page-autosave.queries';
import type { PageTarget } from './page-autosave.queries';
import { SaveRecoveryNotice } from './save-recovery';

type Model = ReturnType<typeof usePageAutosave>;

export function PagePanel({ id, target }: { id: SessionId; target: PageTarget }) {
  const model = usePageAutosave(id, target);
  const { draft } = model;

  return (
    <>
      <SaveRecovery model={model} />
      <Desk.Editor>
        <NoteEditor
          value={draft.text}
          onChange={model.setText}
          toolbarEnd={
            <>
              <SaveStatus model={model} />
              {target.kind === 'message' && (
                <>
                  <Description message={target.message} />
                  <PageDetails message={target.message} />
                </>
              )}
            </>
          }
        />
      </Desk.Editor>
    </>
  );
}

function SaveStatus({ model }: { model: Model }) {
  const { t } = useI18n();
  const { draft } = model;
  const saved = draft.text === draft.savedText;
  const Icon = draft.error ? CloudOff : saved ? Check : Cloud;
  const label = draft.pending
    ? 'SessionAutosaving'
    : saved
      ? 'SessionAutosaved'
      : 'SessionAutosavePending';

  return (
    <Desk.SaveStatus role="status">
      <Icon size={14} />
      {t(label)}
    </Desk.SaveStatus>
  );
}

function SaveRecovery({ model }: { model: Model }) {
  const { t } = useI18n();
  const { draft } = model;

  if (draft.error === undefined) return null;

  return (
    <Desk.Recovery>
      <SaveRecoveryNotice
        conflict={!!draft.conflict}
        onAccept={model.acceptSavedVersion}
        onRetry={() => void model.save()}
      />
      {draft.conflict && (
        <details>
          <summary>{t('SessionSavedPage')}</summary>
          <NoteContent
            value={
              draft.conflict.versions.find(
                (version) => version.id === draft.conflict?.activeVersionId
              )?.text ?? ''
            }
          />
        </details>
      )}
    </Desk.Recovery>
  );
}
