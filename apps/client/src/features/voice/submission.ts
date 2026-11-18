import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import type { DictationSession } from './session';

function submissionScope() {
  const owners = new Set<symbol>();
  const listeners = new Set<() => void>();
  const isBlocked = () => owners.size > 0;

  return {
    isBlocked,
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    update(owner: symbol, pending: boolean) {
      const before = isBlocked();

      if (pending) owners.add(owner);
      else owners.delete(owner);

      if (before !== isBlocked()) for (const listener of listeners) listener();
    }
  };
}

/** Groups the microphone controls that can write to one submitted draft. */
export const DictationSubmissionScope = createContext<ReturnType<typeof submissionScope> | null>(
  null
);

export function useDictationSubmission() {
  const [scope] = useState(submissionScope);
  const blocked = useSyncExternalStore(scope.subscribe, scope.isBlocked);

  return { scope, blocked, isBlocked: scope.isBlocked };
}

export function useDictationSubmissionOwner(
  owner: symbol,
  session: Pick<DictationSession, 'snapshot' | 'subscribe'>
) {
  const scope = useContext(DictationSubmissionScope);

  useLayoutEffect(() => {
    if (!scope) return;

    const sync = () => {
      const { owner: activeOwner, phase, error } = session.snapshot();
      const pending = phase === 'error' ? error === 'transcribe' : phase !== 'idle';

      scope.update(owner, owner === activeOwner && pending);
    };
    const unsubscribe = session.subscribe(sync);

    sync();

    return () => {
      unsubscribe();
      scope.update(owner, false);
    };
  }, [owner, scope, session]);
}
