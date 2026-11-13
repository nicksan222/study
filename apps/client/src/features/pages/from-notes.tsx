import type { ProjectId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger, DialogPopup, DialogFooter } from '@study/ui/dialog';
import { DialogHeading } from '@study/ui/dialog-heading';
import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { NotePageDialog } from '../note-workspace';
import type { SelectedNote } from '../note-workspace';
import { NotePicker } from './note-picker';

export function PagesFromNotes({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedNote[]>([]);
  const [transforming, setTransforming] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" />}>
          <MessagesSquare aria-hidden="true" />
          {t('PagesFromNotes')}
        </DialogTrigger>
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeading
            title={<> {t('SidebarSelectNotes')} </>}
            description={<> {t('PagesSelectNotesHelp')} </>}
          />
          {open && <NotePicker project={project} selected={selected} onChange={setSelected} />}
          <DialogFooter>
            <Button
              disabled={!selected.length}
              onClick={() => {
                setOpen(false);
                setTransforming(true);
              }}
            >
              {t('NoteApplyAction')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {selected[0] && (
        <NotePageDialog
          id={selected[0].id}
          notes={selected}
          open={transforming}
          onOpenChange={setTransforming}
        />
      )}
    </>
  );
}
