import type { SessionId } from '@study/contracts/ids';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@study/ui/dialog';
import { DialogDismissButton } from '@study/ui/dialog-form-actions';
import { WorkspaceSurface } from '@study/ui/workspace';
import type { ReactElement } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { Transformation } from './transformation';

export type SelectedSession = { id: SessionId; title: string };

export function SessionDocumentDialog({
  id,
  open,
  onOpenChange,
  trigger,
  sessions
}: {
  id: SessionId;
  trigger?: ReactElement;
  sessions?: readonly SelectedSession[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogPopup
        keepMounted
        closeLabel={t('Close')}
        variant="workspace-context"
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>{t('SessionTransform')}</DialogTitle>
          <DialogDescription>{t('SessionTransformHelp')}</DialogDescription>
        </DialogHeader>
        <WorkspaceSurface.ContextDialogBody>
          <WorkspaceSurface.Container>
            <Transformation
              active={open}
              id={id}
              sessions={sessions}
              onStarted={() => onOpenChange(false)}
            />
          </WorkspaceSurface.Container>
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogDismissButton label={t('Close')} />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
