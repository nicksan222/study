import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { NoteId } from '@study/contracts/ids';
import type { NoteArchiveTarget } from '@study/contracts/notes/archive';
import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui/toast';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

const pendingArchive = Atom.family((_key: string) => Atom.make(false).pipe(Atom.keepAlive));

/** Committed membership changes update every mounted reader through server revisions. */
export function useItemArchive(noteId: NoteId, target: NoteArchiveTarget) {
  const { t } = useI18n();
  const mutation = rpc.notes.setItemArchived.useMutation();
  const registry = useContext(RegistryContext);
  const atom = pendingArchive(`${noteId}:${target.kind}:${target.id}`);
  const pending = useAtomValue(atom);

  return {
    pending,
    error: mutation.error,
    change: (archived: boolean) => {
      if (registry.get(atom)) return;

      registry.set(atom, true);
      void mutation
        .mutate({ noteId, target, archived })
        .catch(() =>
          toastManager.add({
            title: t('NoteActionErrorTitle'),
            description: t('NoteRequestError'),
            type: 'error'
          })
        )
        .finally(() => registry.set(atom, false));
    }
  };
}
