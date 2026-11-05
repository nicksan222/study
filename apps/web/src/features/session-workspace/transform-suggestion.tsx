import type { transformSuggestionInputSchema } from '@study/contracts/conversations/rpc';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import { toStudyError } from '#web/lib/study-client/errors.ts';

import { transformSuggestionMutationOptions } from './session-workspace.queries';
import type { TransformationModel } from './transformation';
import type { TransformDraft } from './transformation.queries';

const suggestionFields = {
  title: {
    label: 'SessionOutputTitle',
    action: 'SessionGenerateTitle',
    revisionKey: 'titleRevision',
    errorTitle: 'SessionTitleSuggestionError'
  },
  instruction: {
    label: 'SessionInstructions',
    action: 'SessionGenerateInstructions',
    revisionKey: 'instructionRevision',
    errorTitle: 'SessionInstructionsSuggestionError'
  }
} as const;

function suggestionErrorMessage(error: unknown) {
  const kind = toStudyError(error).kind;

  if (kind === 'auth') return 'SessionAuthError';

  if (kind === 'invalid_input' || kind === 'not_enough') return 'SessionSuggestionContextError';

  return 'SessionSuggestionError';
}

export function TransformSuggestion({
  model,
  field
}: {
  model: TransformationModel;
  field: typeof transformSuggestionInputSchema.Type.field;
}) {
  const { id, t, locale, additionalSessionIds, cache, key, setDraft, active, draft } = model;
  const { label, action, revisionKey, errorTitle } = suggestionFields[field];
  const mutation = useMutation(
    transformSuggestionMutationOptions({
      sessionId: id,
      additionalSessionIds: additionalSessionIds.length ? additionalSessionIds : undefined,
      field,
      language: locale
    })
  );

  return (
    <>
      <Notebook.FieldHeading>
        <label htmlFor={`transform-${field}-${id}`}>{t(label)}</label>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t(action)}
          title={t(action)}
          aria-busy={mutation.isPending}
          disabled={
            !active ||
            mutation.isPending ||
            !!draft.attempt ||
            model.pending ||
            !model.suggestionReady
          }
          onClick={() => {
            const context = model.suggestionContext();
            const revision = cache.getQueryData<TransformDraft>(key)?.[revisionKey] ?? 0;

            mutation.mutate(undefined, {
              // Per-call mutation callbacks stop observing when this opening/context unmounts.
              onSuccess: (text) => {
                const current = cache.getQueryData<TransformDraft>(key);

                if (
                  context === model.suggestionContext() &&
                  !current?.attempt &&
                  !current?.pending &&
                  (current?.[revisionKey] ?? 0) === revision
                )
                  setDraft({ [field]: text });
              }
            });
          }}
        >
          <Sparkles aria-hidden="true" />
        </Button>
      </Notebook.FieldHeading>
      {mutation.isPending && <Loading label={t('SessionGeneratingSuggestion')} />}
      {mutation.error && (
        <ErrorState title={t(errorTitle)} description={t(suggestionErrorMessage(mutation.error))} />
      )}
    </>
  );
}
