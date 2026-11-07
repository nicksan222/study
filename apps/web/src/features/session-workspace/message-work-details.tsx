import type { SessionId, MessageId, VersionId } from '@study/contracts/ids';
import { Dialog, DialogPopup } from '@study/ui/dialog';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useQuery } from '@tanstack/react-query';
import type { RefObject } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import { CapturedContext } from './captured-context';
import { provenanceOptions } from './session-workspace.queries';
import { ExecutionStatus, SessionReadError } from './status';

export type MessageWorkTarget = {
  sessionId: SessionId;
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
          title={<> {t('SessionWorkDetails')} </>}
          description={<> {t('SessionWorkDetailsHelp')} </>}
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
  const provenance = useQuery(
    provenanceOptions(target.sessionId, target.messageId, target.versionId)
  );
  const receipt = provenance.isError ? undefined : provenance.data;
  const requestId = receipt?.state === 'available' ? receipt.requestId : undefined;

  if (!requestId) {
    if (provenance.isPending) return <Loading label={t('LoadingStudy')} />;

    if (provenance.error)
      return <SessionReadError error={provenance.error} retry={() => void provenance.refetch()} />;

    return (
      <Notebook.Muted>
        {t(receipt?.state === 'manual' ? 'SessionWorkManual' : 'SessionContextUnavailable')}
      </Notebook.Muted>
    );
  }

  return (
    <>
      <Notebook.WorkSection>
        <Notebook.WorkHeading>{t('SessionWorkActivity')}</Notebook.WorkHeading>
        <ExecutionStatus requestId={requestId} />
        <AgentProgress correlationId={requestId} />
      </Notebook.WorkSection>
      <Notebook.WorkSection>
        <Notebook.WorkHeading>{t('SessionContextUsed')}</Notebook.WorkHeading>
        <CapturedContext requestId={requestId} />
      </Notebook.WorkSection>
    </>
  );
}
