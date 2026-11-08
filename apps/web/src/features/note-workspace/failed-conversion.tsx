import type { ChatMessage, MessageVersion } from '@study/contracts/notes/messages';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';

import { useI18n } from '#web/lib/i18n.tsx';

import { useFailedConversion } from './failed-conversion.queries';
import { NoteError, NoteReadError } from './status';

/** Keeps failed work visible and recoverable without hiding the original note. */
export function FailedMessageConversion({
  message,
  version
}: {
  message: ChatMessage;
  version: MessageVersion;
}) {
  const { t } = useI18n();
  const { snapshot, mutation, canRetry } = useFailedConversion(message, version);

  return (
    <>
      <ErrorState
        title={t('NoteConversionFailed')}
        description={t('NoteConversionFailedHelp')}
        action={
          <>
            <RetryButton
              size="sm"
              variant="outline"
              disabled={!canRetry || mutation.isPending}
              onClick={() => mutation.mutate('retry')}
              label={t('Retry')}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('discard')}
            >
              {t('NoteDiscardConversion')}
            </Button>
          </>
        }
      />
      {snapshot.error && (
        <NoteReadError error={snapshot.error} retry={() => void snapshot.refetch()} />
      )}
      {mutation.error && (
        <NoteError
          error={mutation.error}
          retry={() => {
            if (mutation.variables) mutation.mutate(mutation.variables);
          }}
        />
      )}
    </>
  );
}
