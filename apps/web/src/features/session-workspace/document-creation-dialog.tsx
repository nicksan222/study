import type { SessionId } from '@study/contracts/ids';
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
            <Transformation id={id} sessions={sessions} />
          </WorkspaceSurface.Container>
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
