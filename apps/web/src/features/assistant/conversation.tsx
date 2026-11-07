import { createContext, useContext, useState } from 'react';
import type { Dispatch, SetStateAction, ReactNode } from 'react';

interface AssistantDraft {
  text: string;
  intent?: { text: string; key: string };
}

const Draft = createContext<{
  draft: AssistantDraft;
  setDraft: Dispatch<SetStateAction<AssistantDraft>>;
} | null>(null);

/** Retains unsent text and uncertain request identity across page navigation. History lives in SQLite. */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<AssistantDraft>({ text: '' });

  return <Draft value={{ draft, setDraft }}>{children}</Draft>;
}

export function useAssistantDraft() {
  const draft = useContext(Draft);

  if (!draft) throw new Error('Assistant requires its draft provider');

  return draft;
}
