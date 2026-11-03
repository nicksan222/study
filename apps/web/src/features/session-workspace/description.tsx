import type { ChatMessage } from '@study/contracts/conversations/messages';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@study/ui/dialog';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Text } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { DescriptionField } from './description-field';
import { DescriptionFooter } from './description-footer';
import { useDescription } from './description.queries';
import { SessionError } from './status';

export function Description({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost-muted" size="icon-sm" />}
        aria-label={t('SessionDescriptionTitle')}
        title={t('SessionDescriptionTitle')}
      >
        <Text size={15} aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle>{t('SessionDescriptionTitle')}</DialogTitle>
          <DialogDescription>{t('SessionDescriptionHelp')}</DialogDescription>
        </DialogHeader>
        {open && <DescriptionForm message={message} onSaved={() => setOpen(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function DescriptionForm({ message, onSaved }: { message: ChatMessage; onSaved: () => void }) {
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
        {mutation.error && <SessionError error={mutation.error} />}
      </WorkspaceSurface.ContextDialogBody>
      <DescriptionFooter pending={mutation.isPending} />
    </form>
  );
}
