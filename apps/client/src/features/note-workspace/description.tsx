import type { ChatMessage } from '@study/contracts';
import { DescriptionIcon } from '@study/icons';
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogFormActions,
  DialogHeading,
  WorkspaceSurface
} from '@study/ui';
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
        <DescriptionIcon size={15} aria-hidden="true" />
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
        void mutation.mutate().then(onSaved, () => {});
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
