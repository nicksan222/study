import type { ChatMessage, MessageVersion } from '@study/contracts/notes/messages';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

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
  const { snapshot, mutation, canRetry, readiness } = useFailedConversion(message, version);

  return (
    <>
      <AiReadinessNotice state={readiness} />
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
          retry={
            mutation.variables === 'discard' || readiness === 'ready'
              ? () => {
                  if (
                    mutation.variables &&
                    (mutation.variables === 'discard' || readiness === 'ready')
                  )
                    mutation.mutate(mutation.variables);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
