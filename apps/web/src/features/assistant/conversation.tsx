import type { SessionId } from '@study/contracts/ids';
import { createContext, useContext, useState, useRef } from 'react';
import type { Dispatch, SetStateAction, ReactNode } from 'react';

interface AssistantDraft {
  text: string;
  intent?: { text: string; key: string };
}

const Draft = createContext<{
  takeNewChatKey: () => string;
  clearNewChatKey: () => void;
  clearSentDraft: (id: SessionId, text: string) => void;
  selectedId: SessionId | undefined;
  setSelectedId: Dispatch<SetStateAction<SessionId | undefined>>;
  drafts: ReadonlyMap<string, AssistantDraft>;
  setDrafts: Dispatch<SetStateAction<ReadonlyMap<string, AssistantDraft>>>;
} | null>(null);

/** Drafts and uncertain send identities belong to the selected conversation. */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const newChatKey = useRef<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<SessionId>();
  const [drafts, setDrafts] = useState<ReadonlyMap<string, AssistantDraft>>(new Map());

  return (
    <Draft
      value={{
        selectedId,
        setSelectedId,
        drafts,
        setDrafts,
        takeNewChatKey: () => (newChatKey.current ??= crypto.randomUUID()),
        clearSentDraft: (id, text) =>
          setDrafts((current) => {
            const key = String(id);

            return current.get(key)?.text.trim() === text
              ? new Map(current).set(key, { text: '' })
              : current;
          }),
        clearNewChatKey: () => {
          newChatKey.current = undefined;
        }
      }}
    >
      {children}
    </Draft>
  );
}

export function useAssistantSelection() {
  const state = useContext(Draft);

  if (!state) throw new Error('Assistant requires its draft provider');

  return {
    selectedId: state.selectedId,
    select: state.setSelectedId,
    takeNewChatKey: state.takeNewChatKey,
    clearNewChatKey: state.clearNewChatKey,
    clearSentDraft: state.clearSentDraft
  };
}

export function useAssistantDraft(sessionId?: SessionId) {
  const state = useContext(Draft);

  if (!state) throw new Error('Assistant requires its draft provider');

  const key = sessionId?.toString() ?? 'latest';

  return {
    selectedId: state.selectedId,
    select: state.setSelectedId,
    draft: state.drafts.get(key) ?? { text: '' },
    setDraft: (change: SetStateAction<AssistantDraft>) =>
      state.setDrafts((current) => {
        const value = current.get(key) ?? { text: '' };

        return new Map(current).set(key, typeof change === 'function' ? change(value) : change);
      })
  };
}
