import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { ProjectId } from '@study/contracts';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

const subjectIconPending = Atom.family((_id: ProjectId) => Atom.make(false).pipe(Atom.keepAlive));

const idle = Atom.make(false);

export function useSubjectIconPending(id?: ProjectId) {
  return useAtomValue(id === undefined ? idle : subjectIconPending(id));
}

export function useSubjectIconFence(id: ProjectId) {
  const registry = useContext(RegistryContext);
  const atom = subjectIconPending(id);

  return {
    acquire: () => {
      if (registry.get(atom)) return false;

      registry.set(atom, true);

      return true;
    },
    release: () => registry.set(atom, false)
  };
}
