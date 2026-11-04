import type { StudyDocument } from '@study/contracts/documents/types';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Text } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { DescriptionField } from './description-field';
import { DescriptionFooter } from './description-footer';
import { useDocumentMetadata } from './session-document-metadata.queries';
import { SessionError } from './status';

export function DocumentMetadata({ document }: { document: StudyDocument }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost-muted" size="icon-sm" />}
        aria-label={t('DocumentEditing')}
        title={t('DocumentEditing')}
      >
        <Text size={15} aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle>{t('DocumentEditing')}</DialogTitle>
          <DialogDescription>{t('SessionDescriptionHelp')}</DialogDescription>
        </DialogHeader>
        {open && <MetadataForm document={document} onSaved={() => setOpen(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function MetadataForm({ document, onSaved }: { document: StudyDocument; onSaved: () => void }) {
  const { t } = useI18n();
  const { title, setTitle, description, setDescription, mutation } = useDocumentMetadata(document);
  const fieldId = `document-description-${document.id}`;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(undefined, { onSuccess: onSaved });
      }}
    >
      <WorkspaceSurface.ContextDialogBody>
        <Notebook.Label htmlFor={`${fieldId}-title`}>{t('DocumentTitle')}</Notebook.Label>
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
        {mutation.error && <SessionError error={mutation.error} />}
      </WorkspaceSurface.ContextDialogBody>
      <DescriptionFooter pending={mutation.isPending} disabled={!title.trim()} />
    </form>
  );
}
