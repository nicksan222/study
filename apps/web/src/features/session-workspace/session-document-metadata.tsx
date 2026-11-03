import type { MaterialDetailDto } from '@study/contracts/materials/schemas';
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

import { useI18n } from '../../lib/i18n';
import { DescriptionField } from './description-field';
import { DescriptionFooter } from './description-footer';
import { useDocumentMetadata } from './session-document-metadata.queries';
import { SessionError } from './status';

export function DocumentMetadata({ material }: { material: MaterialDetailDto }) {
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
        {open && <MetadataForm material={material} onSaved={() => setOpen(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function MetadataForm({ material, onSaved }: { material: MaterialDetailDto; onSaved: () => void }) {
  const { t } = useI18n();
  const { title, setTitle, description, setDescription, mutation } = useDocumentMetadata(material);
  const fieldId = `document-description-${material.id}`;

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
