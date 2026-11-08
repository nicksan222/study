import type {
  comparisonSchema,
  editOutcomeSchema,
  saveSchema
} from '@study/contracts/pages/editing';
import type { PageVersion } from '@study/contracts/pages/types';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

type Comparison = typeof comparisonSchema.Type;

type Outcome = typeof editOutcomeSchema.Type;

export function usePageEditor({
  version,
  current
}: {
  version: PageVersion;
  current: PageVersion['id'];
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const content = version.document;
  const document = content;

  // User-authored drafts and exact retry receipts live until explicit discard.
  client.setQueryDefaults(['document-editor'], { gcTime: Infinity });
  const draftKey = ['document-editor', String(version.pageId), String(version.id)];
  const [draft, setDraft] = useState<typeof documentSchema.Type | undefined>(() =>
    client.getQueryData(draftKey)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [outcome, setOutcomeState] = useState<Outcome | undefined>(() =>
    client.getQueryData([...draftKey, 'outcome'])
  );

  function setOutcome(value: Outcome | undefined) {
    setOutcomeState(value);
    client.setQueryData([...draftKey, 'outcome'], value);

    if (!value) client.removeQueries({ queryKey: [...draftKey, 'outcome'], exact: true });
  }

  const [comparison, setComparison] = useState<Comparison>();
  const [savedCopy, setSavedCopy] = useState<string>();
  const saveKey = useRef(
    client.getQueryData<string>([...draftKey, 'save-key']) ?? crypto.randomUUID()
  );

  client.setQueryData([...draftKey, 'save-key'], saveKey.current);
  const [pendingSave, setPendingSave] = useState<typeof saveSchema.Type | undefined>(() =>
    client.getQueryData([...draftKey, 'pending-save'])
  );
  const [undoOutcome, setUndoOutcome] = useState<Outcome | undefined>(() =>
    client.getQueryData([...draftKey, 'undo-outcome'])
  );
  const lock = useRef(false);

  function change(value: typeof documentSchema.Type) {
    setDraft(value);
    client.setQueryData(draftKey, value);
    saveKey.current = crypto.randomUUID();
    client.setQueryData([...draftKey, 'save-key'], saveKey.current);
    setOutcome(undefined);
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
    setDraft(undefined);
    client.removeQueries({ queryKey: draftKey });
    setOutcome(undefined);
    setPendingSave(undefined);
    setUndoOutcome(undefined);
    saveKey.current = crypto.randomUUID();
  }

  return {
    discard,
    t,
    client,
    content,
    document,
    version,
    current,
    draftKey,
    draft,
    setDraft,
    busy,
    error,
    outcome,
    setOutcome,
    comparison,
    setComparison,
    savedCopy,
    setSavedCopy,
    saveKey,
    pendingSave,
    setPendingSave,
    undoOutcome,
    setUndoOutcome,
    change,
    run
  };
}
