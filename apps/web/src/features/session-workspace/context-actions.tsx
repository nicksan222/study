import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter
} from '@study/ui/dialog';
import { WorkspaceCard } from '@study/ui/workspace';
import { ArrowUpRight, FileInput, WandSparkles, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { SelectionPanel } from './selection';
import { Transformation } from './transformation';

function ContextAction({
  title,
  icon,
  children
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog>
      <DialogTrigger render={<WorkspaceCard.Item />}>
        {icon}
        <span>{title}</span>
        <ArrowUpRight aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup
        keepMounted
        closeLabel={t('Close')}
        className="session-context-dialog"
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="session-context-dialog-body">
          <div className="session-workspace">{children}</div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SessionContextActions({ id, onDelete }: { id: SessionId; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <WorkspaceCard.Group className="session-context-actions">
      <ContextAction title={t('SessionSelection')} icon={<FileInput aria-hidden="true" />}>
        <SelectionPanel id={id} />
      </ContextAction>
      <ContextAction title={t('SessionTransform')} icon={<WandSparkles aria-hidden="true" />}>
        <Transformation id={id} />
      </ContextAction>
      <WorkspaceCard.Item variant="ghost-destructive" onClick={onDelete}>
        <Trash2 aria-hidden="true" />
        <span>{t('SessionDelete')}</span>
      </WorkspaceCard.Item>
    </WorkspaceCard.Group>
  );
}
