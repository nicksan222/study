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
import { WorkspaceCard, WorkspaceSurface, WorkspaceChanges } from '@study/ui/workspace';
import { ArrowUpRight, FileInput, WandSparkles, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { SelectionPanel } from './selection';
import { Transformation } from './transformation';

function ContextAction({
  title,
  icon,
  children,
  compact
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Dialog>
      <DialogTrigger
        aria-label={title}
        title={compact ? title : undefined}
        render={compact ? <Button variant="ghost-muted" size="icon-sm" /> : <WorkspaceCard.Item />}
      >
        {icon}
        {!compact && (
          <>
            <span>{title}</span>
            <ArrowUpRight aria-hidden="true" />
          </>
        )}
      </DialogTrigger>
      <DialogPopup
        keepMounted
        closeLabel={t('Close')}
        variant="workspace-context"
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <WorkspaceSurface.ContextDialogBody>
          <WorkspaceSurface.Container>{children}</WorkspaceSurface.Container>
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SessionContextActions({
  id,
  onDelete,
  compact
}: {
  id: SessionId;
  onDelete: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceChanges.Actions>
      <ContextAction
        compact={compact}
        title={t('SessionSelection')}
        icon={<FileInput aria-hidden="true" />}
      >
        <SelectionPanel id={id} />
      </ContextAction>
      <ContextAction
        compact={compact}
        title={t('SessionTransform')}
        icon={<WandSparkles aria-hidden="true" />}
      >
        <Transformation id={id} />
      </ContextAction>
      {compact ? (
        <Button
          variant="ghost-muted"
          size="icon-sm"
          title={t('SessionDelete')}
          aria-label={t('SessionDelete')}
          onClick={onDelete}
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      ) : (
        <WorkspaceCard.Item variant="ghost-destructive" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          <span>{t('SessionDelete')}</span>
        </WorkspaceCard.Item>
      )}
    </WorkspaceChanges.Actions>
  );
}
