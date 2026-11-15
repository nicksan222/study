import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type {
  comparisonSchema,
  editOutcomeSchema,
  saveSchema,
  restoreSchema
} from '@study/contracts/pages/editing';
import type { PageVersion } from '@study/contracts/pages/types';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Atom } from 'effect/reactivity';
import { useContext, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

type Outcome = typeof editOutcomeSchema.Type;

type Draft = {
  document?: typeof documentSchema.Type;
  outcome?: Outcome;
  saveKey: string;
  pendingSave?: typeof saveSchema.Type;
  undoInput?: typeof restoreSchema.Type;
  undoOutcome?: Outcome;
};

const drafts = Atom.family((_identity: string) =>
  Atom.make<Draft>({ saveKey: crypto.randomUUID() }).pipe(Atom.keepAlive)
);

/** Authored drafts and exact uncertain receipts are local state, independent of transport recovery. */
export function usePageEditor({
  version,
  current
}: {
  version: PageVersion;
  current: PageVersion['id'];
}) {
  const { t } = useI18n();
  const registry = useContext(RegistryContext);
  const atom = drafts(`${version.pageId}:${version.id}`);
  const state = useAtomValue(atom);
  const update = (patch: Partial<Draft>) => registry.set(atom, { ...registry.get(atom), ...patch });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [comparison, setComparison] = useState<typeof comparisonSchema.Type>();
  const [savedCopy, setSavedCopy] = useState<string>();
  const saveKey = useRef(state.saveKey);

  saveKey.current = state.saveKey;
  const lock = useRef(false);

  function change(document: typeof documentSchema.Type) {
    update({ document, saveKey: crypto.randomUUID(), outcome: undefined });
    setComparison(undefined);
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError(false);

    try {
      await action();
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function discard() {
    registry.set(atom, { saveKey: crypto.randomUUID() });
    setComparison(undefined);
  }

  return {
    t,
    version,
    current,
    content: version.document,
    document: version.document,
    draft: state.document,
    busy,
    error,
    outcome: state.outcome,
    setOutcome: (outcome: Outcome | undefined) => update({ outcome }),
    comparison,
    setComparison,
    savedCopy,
    setSavedCopy,
    saveKey,
    pendingSave: state.pendingSave,
    setPendingSave: (pendingSave: typeof saveSchema.Type | undefined) => update({ pendingSave }),
    undoOutcome: state.undoOutcome,
    setUndoOutcome: (undoOutcome: Outcome | undefined) => update({ undoOutcome }),
    undoInput: state.undoInput,
    setUndoInput: (undoInput: typeof restoreSchema.Type) => update({ undoInput }),
    change,
    run,
    discard
  };
}
