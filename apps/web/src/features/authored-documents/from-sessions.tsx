import type { ProjectId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger, DialogPopup, DialogFooter } from '@study/ui/dialog';
import { DialogHeading } from '@study/ui/dialog-heading';
import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { SessionDocumentDialog } from '../session-workspace';
import type { SelectedSession } from '../session-workspace';
import { SessionPicker } from './session-picker';

export function DocumentsFromSessions({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedSession[]>([]);
  const [transforming, setTransforming] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" />}>
          <MessagesSquare aria-hidden="true" />
          {t('DocumentsFromSessions')}
        </DialogTrigger>
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeading
            title={<> {t('SidebarSelectSessions')} </>}
            description={<> {t('DocumentsSelectSessionsHelp')} </>}
          />
          {open && <SessionPicker project={project} selected={selected} onChange={setSelected} />}
          <DialogFooter>
            <Button
              disabled={!selected.length}
              onClick={() => {
                setOpen(false);
                setTransforming(true);
              }}
            >
              {t('SessionApplyAction')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {selected[0] && (
        <SessionDocumentDialog
          id={selected[0].id}
          sessions={selected}
          open={transforming}
          onOpenChange={setTransforming}
        />
      )}
    </>
  );
}
