import type { ChatMessage } from '@study/contracts/notes/messages';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger, DialogPopup } from '@study/ui/dialog';
import { DialogFormActions } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Text } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { DescriptionField } from './description-field';
import { useDescription } from './description.queries';
import { NoteError } from './status';

export function Description({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost-muted" size="icon-sm" />}
        aria-label={t('NoteDescriptionTitle')}
        title={t('NoteDescriptionTitle')}
      >
        <Text size={15} aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeading
          title={<> {t('NoteDescriptionTitle')} </>}
          description={<> {t('NoteDescriptionHelp')} </>}
        />
        {open && <DescriptionForm message={message} onSaved={() => setOpen(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function DescriptionForm({ message, onSaved }: { message: ChatMessage; onSaved: () => void }) {
  const { t } = useI18n();
  const { text, setText, mutation } = useDescription(message);
  const fieldId = `note-description-${message.id}`;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(undefined, { onSuccess: onSaved });
      }}
    >
      <WorkspaceSurface.ContextDialogBody>
        <DescriptionField
          id={fieldId}
          value={text}
          onChange={setText}
          disabled={mutation.isPending}
        />
        {mutation.error && <NoteError error={mutation.error} />}
      </WorkspaceSurface.ContextDialogBody>
      <DialogFormActions
        cancelLabel={t('Cancel')}
        submitLabel={t(mutation.isPending ? 'NoteSaving' : 'Save')}
        pending={mutation.isPending}
      />
    </form>
  );
}
