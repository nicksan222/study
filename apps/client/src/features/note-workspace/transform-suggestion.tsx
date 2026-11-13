import type { transformSuggestionInputSchema } from '@study/contracts/notes/rpc';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/note-workspace';
import { useMutation } from '@tanstack/react-query';

import { AiActionButton as AiButton } from '#client/lib/ai-action-button.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { transformSuggestionMutationOptions } from './note-workspace.queries';
import type { TransformationModel } from './transformation';
import type { TransformDraft } from './transformation.queries';

const suggestionFields = {
  title: {
    label: 'NoteOutputTitle',
    action: 'NoteGenerateTitle',
    revisionKey: 'titleRevision',
    errorTitle: 'NoteTitleSuggestionError'
  },
  instruction: {
    label: 'NoteInstructions',
    action: 'NoteGenerateInstructions',
    revisionKey: 'instructionRevision',
    errorTitle: 'NoteInstructionsSuggestionError'
  }
} as const;

/** Distinguish saved-context failures from retryable generation failures. */
function suggestionErrorMessage(error: unknown) {
  const kind = toStudyError(error).kind;

  if (kind === 'auth') return 'NoteAuthError';

  if (kind === 'invalid_input' || kind === 'not_enough') return 'NoteSuggestionContextError';

  return 'NoteSuggestionError';
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
  const readiness = model.suggestionReadiness;
  const { id, t, locale, additionalNoteIds, cache, key, setDraft } = model;
  const { label, action, revisionKey, errorTitle } = suggestionFields[field];
  const exceedsNoteLimit = additionalNoteIds.length > 19;
  const mutation = useMutation(
    transformSuggestionMutationOptions({
      noteId: id,
      additionalNoteIds: additionalNoteIds.length ? additionalNoteIds : undefined,
      field,
      language: locale
    })
  );

  return (
    <>
      <Notebook.FieldHeading>
        <label htmlFor={`transform-${field}-${id}`}>{t(label)}</label>
        <AiButton
          tier="tiny"
          size="icon-sm"
          variant="ghost"
          label={t(action)}
          pending={mutation.isPending}
          workingLabel={t('NoteGeneratingSuggestion')}
          aria-busy={mutation.isPending}
          disabled={
            readiness !== 'ready' ||
            exceedsNoteLimit ||
            mutation.isPending ||
            suggestionUnavailable(model)
          }
          onClick={() => {
            if (
              readiness !== 'ready' ||
              exceedsNoteLimit ||
              mutation.isPending ||
              suggestionUnavailable(model)
            )
              return;

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
      {exceedsNoteLimit && <Notebook.Muted>{t('NoteSuggestionLimit')}</Notebook.Muted>}
      {mutation.error && (
        <ErrorState title={t(errorTitle)} description={t(suggestionErrorMessage(mutation.error))} />
      )}
    </>
  );
}
