import { RegistryContext, useAtom } from '@effect/atom-react';
import type { ErrorKind, ProjectId } from '@study/contracts';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';

type NameDraft = { text: string; revision: number };

type CollectionState = {
  name: NameDraft;
  names: Record<string, NameDraft>;
  selected: ProjectId | null;
  accepted: ProjectId | null;
  uncertain: boolean;
  pending: boolean;
  reviewed: boolean;
  error?: ErrorKind;
};

const initial: CollectionState = {
  name: { text: '', revision: 0 },
  names: {},
  selected: null,
  accepted: null,
  uncertain: false,
  pending: false,
  reviewed: false
};

const drafts = Atom.make(initial).pipe(Atom.keepAlive);

/** Matches the database name limit using Unicode code points after trimming. */
export function validCollectionName(name: string) {
  return name.trim().length > 0 && [...name.trim()].length <= 100;
}

/** Shares drafts and mutation ownership across collection views and subject settings. */
export function useCollectionState() {
  const registry = useContext(RegistryContext);
  const [state, update] = useAtom(drafts);

  /** Advances the subject-specific draft revision so late responses cannot erase newer edits. */
  function changeName(id: ProjectId, text: string) {
    update((value) => ({
      ...value,
      names: {
        ...value.names,
        [String(id)]: {
          text,
          revision: (value.names[String(id)]?.revision ?? 0) + 1
        }
      }
    }));
  }

  /** Clears only the draft revision acknowledged by a successful rename. */
  function acceptName(id: ProjectId, revision: number | undefined) {
    update((value) => {
      if (value.names[String(id)]?.revision !== revision) return value;

      const names = { ...value.names };

      delete names[String(id)];

      return { ...value, names };
    });
  }

  /** Serializes collection writes and reconciles reads even when a committed response is lost. */
  async function mutate(action: () => Promise<unknown>) {
    if (registry.get(drafts).pending) return;

    update((value) => ({ ...value, pending: true, error: undefined, reviewed: false }));

    try {
      await action();
    } catch (error) {
      update((value) => ({ ...value, error: toStudyError(error).kind }));
    } finally {
      update((value) => ({ ...value, pending: false }));
    }
  }

  return { state, update, mutate, changeName, acceptName };
}
