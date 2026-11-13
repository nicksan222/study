import type { SourceId } from '@study/contracts/ids';
import type { KeyboardEvent } from 'react';

import type { AskInput } from './note-workspace.queries';

export type Draft = {
  text: string;
  instruction: string;
  askAttempt?: AskInput;
  askUnavailable?: boolean;
  noteAttempt?: string;
  noteSourceIds?: readonly SourceId[];
  pending?: boolean;
  preferences?: { language?: 'english' | 'italian'; detail?: 'brief' | 'balanced' | 'detailed' };
};

export const emptyDraft: Draft = { text: '', instruction: '' };

/** A receipt clears only its submitted text; typing during an in-flight save survives. */
export function acceptText(draft: Draft, submitted: string): Draft {
  return {
    ...draft,
    text: draft.text === submitted ? '' : draft.text,
    askAttempt: undefined,
    askUnavailable: undefined,
    noteAttempt: undefined
  };
}

/** Preserve exact payload and key across ambiguous transport failures and navigation. */
export function prepareAsk(
  draft: Draft,
  input: Omit<AskInput, 'text' | 'intentKey'>,
  intentKey: string
): AskInput {
  return draft.askAttempt ?? { ...input, text: draft.text, intentKey };
}

/** The draft and saved notebook share the same capture shortcut. */
export function isNoteSubmit(event: KeyboardEvent<HTMLTextAreaElement>, submitOnEnter: boolean) {
  return (
    (event.metaKey || event.ctrlKey || (submitOnEnter && !event.shiftKey && !event.altKey)) &&
    event.key === 'Enter' &&
    !event.nativeEvent.isComposing
  );
}
