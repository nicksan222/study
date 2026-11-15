import type { NoteId } from '@study/contracts';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogFooter,
  DialogDismissButton,
  DialogHeading,
  WorkspaceSurface
} from '@study/ui';
import type { ReactElement } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { Transformation } from './transformation';

export type SelectedNote = { id: NoteId; title: string };

export function NotePageDialog({
  id,
  open,
  onOpenChange,
  trigger,
  notes
}: {
  id: NoteId;
  trigger?: ReactElement;
  notes?: readonly SelectedNote[];
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
        <DialogHeading
          title={<> {t('NoteTransform')} </>}
          description={<> {t('NoteTransformHelp')} </>}
        />
        <WorkspaceSurface.ContextDialogBody>
          <WorkspaceSurface.Container>
            <Transformation
              active={open}
              id={id}
              notes={notes}
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
