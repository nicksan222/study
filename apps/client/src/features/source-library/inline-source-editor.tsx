import { useAtom } from '@effect/atom-react';
import type { Source, SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { EditIcon } from '@study/icons';
import {
  Button,
  IconButton,
  ErrorState,
  Loading,
  SourceReader,
  RetryButton,
  Textarea,
  toastManager
} from '@study/ui';
import { Atom } from 'effect/reactivity';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';

type Draft = {
  revision: number;
  text?: string;
  pending?: boolean;
  error?: unknown;
};

/** The expected revision travels with unsaved text when switching between materials. */
const drafts = Atom.family((_id: SourceId) =>
  Atom.make<Draft | undefined>(undefined).pipe(Atom.keepAlive)
);

function useSourceDraft(id: SourceId) {
  return useAtom(drafts(id));
}

export function EditSourceButton({ source }: { source: Source }) {
  const { t } = useI18n();
  const state = rpc.sources.sourceProcessing.useQuery({ id: source.id });
  const [, setDraft] = useSourceDraft(source.id);
  const revision = state.data?.revision;

  if (state.error) return <ContentReadError error={state.error} retry={state.retry} />;

  return (
    <IconButton
      size="icon-sm"
      label={t('MaterialEditFile')}
      disabled={!revision}
      onClick={() => revision && setDraft({ revision })}
    >
      <EditIcon aria-hidden="true" />
    </IconButton>
  );
}

function decode(bytes: Uint8Array | undefined) {
  if (!bytes) return undefined;

  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function EditableMaterial({
  id,
  pinned,
  children
}: {
  id: SourceId;
  pinned: boolean;
  children: ReactNode;
}) {
  const [draft] = useSourceDraft(id);
  const source = rpc.sources.get.useQuery(draft && !pinned ? { id } : undefined);

  if (!draft || pinned || !source.data) return children;

  return (
    <SourceReader.Root data-materials-reader>
      <SourceReader.Header>
        <SourceReader.Title>{source.data.name}</SourceReader.Title>
      </SourceReader.Header>
      <InlineSourceEditor key={String(id)} source={source.data} draft={draft} />
    </SourceReader.Root>
  );
}

function InlineSourceEditor({ source, draft }: { source: Source; draft: Draft }) {
  const { t } = useI18n();
  const [, setDraft] = useSourceDraft(source.id);
  const pinned = rpc.sources.exportRevision.useQuery({
    sourceId: source.id,
    revision: BigInt(draft.revision)
  });
  const original = useMemo(() => decode(pinned.data?.bytes), [pinned.data?.bytes]);
  const cancel = (
    <Button variant="ghost" disabled={draft.pending} onClick={() => setDraft(undefined)}>
      {t('Cancel')}
    </Button>
  );

  if (pinned.error)
    return (
      <ErrorState
        title={t('ReaderOriginalUnavailable')}
        action={
          <SourceReader.Actions>
            {cancel}
            <RetryButton label={t('Retry')} onClick={pinned.retry} />
          </SourceReader.Actions>
        }
      />
    );

  if (pinned.isPending)
    return (
      <>
        {cancel}
        <Loading label={t('LoadingStudy')} />
      </>
    );

  if (original === undefined)
    return <ErrorState title={t('MaterialEditEncoding')} action={cancel} />;

  return <RevisionForm source={source} draft={draft} original={original} cancel={cancel} />;
}

function RevisionForm({
  source,
  draft,
  original,
  cancel
}: {
  source: Source;
  draft: Draft;
  original: string;
  cancel: ReactNode;
}) {
  const { t } = useI18n();
  const [, setDraft] = useSourceDraft(source.id);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = original.slice(bom.length);
  const normalized = body.replace(/\r\n?/g, '\n');
  const text = draft.text ?? normalized;

  async function save() {
    if (draft.pending || !text.length || text === normalized) return;

    setDraft({ ...draft, pending: true, error: undefined });
    const newline =
      body.includes('\r\n') && !body.replaceAll('\r\n', '').includes('\n') ? '\r\n' : '\n';
    const bytes = new TextEncoder().encode(bom + text.replaceAll('\n', newline));

    try {
      await rpc.sources.replaceSource.call({
        id: source.id,
        expectedRevision: draft.revision,
        name: source.name,
        bytes
      });
      setDraft(undefined);
      toastManager.add({ type: 'success', title: t('MaterialRevisionSaved') });
    } catch (error) {
      setDraft({ ...draft, text, pending: false, error });
    }
  }

  return (
    <SourceReader.Editor>
      <Textarea
        ref={input}
        font="mono"
        aria-label={t('MaterialFileContents')}
        value={text}
        readOnly={draft.pending}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
        }}
        onChange={(event) =>
          setDraft({ ...draft, text: event.currentTarget.value, error: undefined })
        }
      />
      <SourceReader.Actions>
        {text !== normalized && <p>{t('MaterialUnsavedRevision')}</p>}
        {cancel}
        <Button
          disabled={draft.pending || text === normalized || !text.length}
          onClick={() => void save()}
        >
          {t(draft.pending ? 'NoteSaving' : 'MaterialSaveRevision')}
        </Button>
      </SourceReader.Actions>
      {draft.error !== undefined && (
        <ContentReadError error={draft.error} retry={() => void save()} />
      )}
    </SourceReader.Editor>
  );
}
