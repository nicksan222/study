import type { AskInput } from './note-workspace.queries';

export type Draft = {
  text: string;
  instruction: string;
  askAttempt?: AskInput;
  askUnavailable?: boolean;
  noteAttempt?: string;
  pending?: boolean;
  preferences?: { language?: 'english' | 'italian'; detail?: 'brief' | 'balanced' | 'detailed' };
};

export const emptyDraft: Draft = { text: '', instruction: '' };
