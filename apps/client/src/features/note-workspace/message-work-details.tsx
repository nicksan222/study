import type { NoteId, MessageId, VersionId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Dialog, DialogPopup, DialogHeading, Loading, Notebook, WorkspaceSurface } from '@study/ui';
import type { RefObject } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import { CapturedContext } from './captured-context';
import { ExecutionStatus, NoteReadError } from './status';

export type MessageWorkTarget = {
  noteId: NoteId;
  messageId: MessageId;
  versionId: VersionId;
};

export function MessageWorkDetails({
  open,
  onOpenChange,
  target,
  finalFocus
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: MessageWorkTarget | undefined;
  finalFocus: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup variant="workspace-context" closeLabel={t('Close')} finalFocus={finalFocus}>
        <DialogHeading
          title={<> {t('NoteWorkDetails')} </>}
          description={<> {t('NoteWorkDetailsHelp')} </>}
        />
        <WorkspaceSurface.ContextDialogBody>
          {open && target && <WorkContent target={target} />}
        </WorkspaceSurface.ContextDialogBody>
      </DialogPopup>
    </Dialog>
  );
}

function WorkContent({ target }: { target: MessageWorkTarget }) {
  const { t } = useI18n();
  const provenance = rpc.notes.replyVersion.useQuery({
    noteId: target.noteId,
    messageId: target.messageId,
    versionId: target.versionId
  });
  const receipt = provenance.isError ? undefined : provenance.data;
  const requestId = receipt?.state === 'available' ? receipt.requestId : undefined;

  if (!requestId) {
    if (provenance.isPending) return <Loading label={t('LoadingStudy')} />;

    if (provenance.error)
      return <NoteReadError error={provenance.error} retry={() => void provenance.refetch()} />;

    return (
      <Notebook.Muted>
        {t(receipt?.state === 'manual' ? 'NoteWorkManual' : 'NoteContextUnavailable')}
      </Notebook.Muted>
    );
  }

  return (
    <>
      <Notebook.WorkSection>
        <Notebook.WorkHeading>{t('NoteWorkActivity')}</Notebook.WorkHeading>
        <ExecutionStatus requestId={requestId} />
        <AgentProgress correlationId={requestId} />
      </Notebook.WorkSection>
      <Notebook.WorkSection>
        <Notebook.WorkHeading>{t('NoteContextUsed')}</Notebook.WorkHeading>
        <CapturedContext requestId={requestId} />
      </Notebook.WorkSection>
    </>
  );
}
