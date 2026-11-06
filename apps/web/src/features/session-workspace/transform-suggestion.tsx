import type { transformSuggestionInputSchema } from '@study/contracts/conversations/rpc';
import { AiButton } from '@study/ui/ai-button';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/session-workspace';
import { useMutation } from '@tanstack/react-query';

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

/** Distinguish saved-context failures from retryable generation failures. */
function suggestionErrorMessage(error: unknown) {
  const kind = toStudyError(error).kind;

  if (kind === 'auth') return 'SessionAuthError';

  if (kind === 'invalid_input' || kind === 'not_enough') return 'SessionSuggestionContextError';

  return 'SessionSuggestionError';
}

/** Prevent suggestions while the captured transformation context is unavailable or busy. */
function suggestionUnavailable(model: TransformationModel) {
  return !model.active || !!model.draft.attempt || model.pending || !model.suggestionReady;
}

/** Apply a field suggestion only while its captured context and draft revision remain current. */
export function TransformSuggestion({
  model,
  field
}: {
  model: TransformationModel;
  field: typeof transformSuggestionInputSchema.Type.field;
}) {
  const { id, t, locale, additionalSessionIds, cache, key, setDraft } = model;
  const { label, action, revisionKey, errorTitle } = suggestionFields[field];
  const exceedsSessionLimit = additionalSessionIds.length > 19;
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
        <AiButton
          size="icon-sm"
          variant="ghost"
          label={t(action)}
          pending={mutation.isPending}
          workingLabel={t('SessionGeneratingSuggestion')}
          aria-busy={mutation.isPending}
          disabled={exceedsSessionLimit || mutation.isPending || suggestionUnavailable(model)}
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
        />
      </Notebook.FieldHeading>
      {exceedsSessionLimit && <Notebook.Muted>{t('SessionSuggestionLimit')}</Notebook.Muted>}
      {mutation.error && (
        <ErrorState title={t(errorTitle)} description={t(suggestionErrorMessage(mutation.error))} />
      )}
    </>
  );
}
