import type {
  createManualDocumentSchema,
  documentComparisonSchema,
  documentEditOutcomeSchema,
  saveDocumentInputSchema
} from '@study/contracts/materials/editing';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, useRef } from 'react';
import type { FormEvent } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { request } from '../../lib/study-client/request';
import { blankDocument } from './block-editor';

type Comparison = typeof documentComparisonSchema.Type;

type Outcome = typeof documentEditOutcomeSchema.Type;

export function useDocumentCreation() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();

  type Creation = {
    title: string;
    text: string;
    busy: boolean;
    error?: 'rejected' | 'uncertain';
    createdId?: string;
    submitted?: typeof createManualDocumentSchema.Type;
  };

  const creationKey = ['document-creation'];
  const initial: Creation = { title: '', text: '', busy: false };
  const creation = useQuery<Creation>({
    queryKey: creationKey,
    initialData: initial,
    queryFn: () => initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const { title, text, busy, error, createdId, submitted } = creation.data;

  function change(next: Partial<Creation>) {
    client.setQueryData<Creation>(creationKey, (old) => ({ ...old!, ...next }));
  }

  const setTitle = (title: string) => change({ title });
  const setText = (text: string) => change({ text });
  const setBusy = (busy: boolean) => change({ busy });
  const setError = (error: Creation['error']) => change({ error });
  const setCreatedId = (createdId: string) => change({ createdId });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const latest = client.getQueryData<Creation>(creationKey);

    if (
      creationLocked(latest) ||
      error === 'uncertain' ||
      createdId ||
      !title.trim() ||
      !text.trim()
    )
      return;

    const input: typeof createManualDocumentSchema.Type = {
      title,
      document: {
        ...blankDocument(),
        blocks: [plainBlock('paragraph', text, { type: 'authored' })]
      }
    };

    change({ busy: true, error: undefined, submitted: input });

    try {
      const material = await request((rpc) => rpc['materials.createManualDocument'](input));

      setCreatedId(String(material.id));
      await client.invalidateQueries({ queryKey: ['materials'] });
      await navigate({
        to: '/materials/$materialId',
        params: { materialId: String(material.id) },
        search: {}
      });
    } catch (cause) {
      setError(toStudyError(cause).kind === 'invalid_input' ? 'rejected' : 'uncertain');
    } finally {
      setBusy(false);
    }
  }

  return {
    t,
    open,
    setOpen,
    client,
    creationKey,
    initial,
    title,
    text,
    busy,
    error,
    createdId,
    submitted,
    setTitle,
    setText,
    submit
  };
}

export function useDocumentEditor({
  version,
  current
}: {
  version: MaterialVersionDetailDto;
  current: MaterialVersionDetailDto['id'];
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const content = version.content;
  const document = editableDocument(content);

  // User-authored drafts and exact retry receipts live until explicit discard.
  client.setQueryDefaults(['document-editor'], { gcTime: Infinity });
  const draftKey = ['document-editor', String(version.material_id), String(version.id)];
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
  const [pendingSave, setPendingSave] = useState<typeof saveDocumentInputSchema.Type | undefined>(
    () => client.getQueryData([...draftKey, 'pending-save'])
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

function creationLocked(value: { busy: boolean; createdId?: string; error?: string } | undefined) {
  return value?.busy || value?.createdId || value?.error === 'uncertain';
}

function editableDocument(content: MaterialVersionDetailDto['content']) {
  return content.kind === 'document'
    ? content
    : 'extracted' in content
      ? content.extracted?.document
      : undefined;
}
