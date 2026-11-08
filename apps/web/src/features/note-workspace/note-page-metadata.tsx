import type { Page } from '@study/contracts/pages/types';
import { Dialog, DialogTrigger, DialogPopup } from '@study/ui/dialog';
import { DialogFormActions } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { IconButton } from '@study/ui/icon-button';
import { Input } from '@study/ui/input';
import { Notebook } from '@study/ui/note-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Text } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { DescriptionField } from './description-field';
import { usePageMetadata } from './note-page-metadata.queries';
import { NoteError } from './status';

export function PageMetadata({ page }: { page: Page }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <PageMetadataDialog
      page={page}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton variant="ghost-muted" size="icon-sm" label={t('PageEditing')}>
          <Text size={15} aria-hidden="true" />
        </IconButton>
      }
    />
  );
}

export function PageMetadataDialog({
  page,
  open,
  onOpenChange,
  trigger
}: {
  page: Page;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeading
          title={<> {t('PageEditing')} </>}
          description={<> {t('NoteDescriptionHelp')} </>}
        />
        {open && <MetadataForm page={page} onSaved={() => onOpenChange(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function MetadataForm({ page, onSaved }: { page: Page; onSaved: () => void }) {
  const { t } = useI18n();
  const { title, setTitle, description, setDescription, mutation } = usePageMetadata(page);
  const fieldId = `page-description-${page.id}`;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(undefined, { onSuccess: onSaved });
      }}
    >
      <WorkspaceSurface.ContextDialogBody>
        <Notebook.Label htmlFor={`${fieldId}-title`}>{t('PageTitle')}</Notebook.Label>
        <Input
          id={`${fieldId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          disabled={mutation.isPending}
        />
        <DescriptionField
          id={fieldId}
          value={description}
          onChange={setDescription}
          disabled={mutation.isPending}
        />
        {mutation.error && <NoteError error={mutation.error} />}
      </WorkspaceSurface.ContextDialogBody>
      <DialogFormActions
        cancelLabel={t('Cancel')}
        submitLabel={t(mutation.isPending ? 'NoteSaving' : 'Save')}
        pending={mutation.isPending}
        disabled={!title.trim()}
      />
    </form>
  );
}
