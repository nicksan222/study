import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type {
  sessionSelectionTargetSchema,
  selectionReferenceSchema
} from '@study/contracts/conversations/context';
import type {
  SessionId,
  SourceId,
  StudyDocumentId,
  StudyDocumentVersionId,
  ContentSnapshotId
} from '@study/contracts/ids';
import { validBlockTextRange } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Notebook } from '@study/ui/session-workspace';
import { Textarea } from '@study/ui/textarea';
import { WorkspaceSurface } from '@study/ui/workspace';
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import {
  documentHistoryOptions,
  documentsOptions
} from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

import { HistoryDisclosure } from '../document-presentation/history';
import { SourceHistory } from '../source-library/history';
import { sourceExtractionOptions } from '../source-library/source-panel.queries';
import {
  selectionDraftOptions,
  saveSelectionOptions,
  selectedContentOptions,
  selectionSourcesOptions
} from './selection.queries';
import { sessionDocumentOptions } from './session-document.queries';
import { selectionOptions } from './session-workspace.queries';
import type { Selection } from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';

type Target = typeof sessionSelectionTargetSchema.Type;
type Reference = typeof selectionReferenceSchema.Type;

function useSelection(id: SessionId) {
  const cache = useQueryClient();
  const selected = useQuery(selectionOptions(id));
  const draftOptions = selectionDraftOptions(id);
  const draftKey = ['session-drafts', String(id), 'selection'];
  const draft = useQuery(draftOptions);
  const current = draft.data ?? selected.data;
  const mutationKey = ['session-selection-save', String(id)];
  const saving = useIsMutating({ mutationKey, exact: true }) > 0;
  const save = useMutation({
    mutationKey,
    retry: false,
    ...saveSelectionOptions(id),
    onSuccess: (value, submitted) => {
      cache.setQueryData<Selection>(selectionOptions(id).queryKey, (previous) =>
        !previous || previous.revision <= value.revision ? value : previous
      );
      cache.setQueryData<Selection | null>(draftKey, (previous) => {
        if (previous === submitted) return null;
        return previous && previous.revision === submitted.revision
          ? { ...previous, revision: value.revision }
          : previous;
      });
    }
  });
  function change(target: Target, remove = false) {
    if (!current || saving) return;
    const key = selectionReferenceKey(target.input);
    const rest = current.targets.filter((item) => selectionReferenceKey(item.input) !== key);
    const next: Selection = {
      revision: current.revision,
      targets: remove ? rest : [...rest, target]
    };
    cache.setQueryData<Selection | null>(draftKey, () => next);
    save.reset();
  }
  function reload() {
    cache.setQueryData(draftKey, null);
    save.reset();
    void selected.refetch();
  }
  return { current, selected, draft, saving, save, change, reload };
}
export function SelectionPanel({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const model = useSelection(id);
  const { selected, current, saving, change, save, draft } = model;
  const [search, setSearch] = useState('');
  const documents = useInfiniteQuery(documentsOptions());
  const sources = useQuery(selectionSourcesOptions());
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  return (
    <WorkspaceSurface.Section>
      <Notebook.Muted>{t('SessionSelectionHelp')}</Notebook.Muted>
      {selected.isPending && <Loading label={t('LoadingStudy')} />}
      {selected.error && (
        <SessionReadError error={selected.error} retry={() => void selected.refetch()} />
      )}
      <ul>
        {current?.targets.map((target) => (
          <li key={selectionReferenceKey(target.input)}>
            <SelectedTarget target={target} />
            <Button variant="ghost" disabled={saving} onClick={() => change(target, true)}>
              {t('SessionRemove')}
            </Button>
          </li>
        ))}
      </ul>
      <Button disabled={!draft.data || saving} onClick={() => current && save.mutate(current)}>
        {t('SessionSaveSelection')}
      </Button>
      <Button variant="ghost" disabled={saving} onClick={model.reload}>
        {t('LibraryRefresh')}
      </Button>
      {save.error && <SessionError error={save.error} />}
      {draft.data && <p role="status">{t('SessionSelectionUnsaved')}</p>}
      <Input
        aria-label={t('SessionSearchMaterial')}
        value={search}
        maxLength={1000}
        onValueChange={setSearch}
      />
      {documents.error && (
        <SessionReadError error={documents.error} retry={() => void documents.refetch()} />
      )}
      <Notebook.Materials>
        {documents.data?.pages
          .flatMap((page) => page.items)
          .filter((item) => matches(item.title))
          .map((item) => (
            <li key={`document:${item.id}`}>
              <SelectionDisclosure title={item.title}>
                <DocumentSelection id={item.id} model={model} />
              </SelectionDisclosure>
            </li>
          ))}
        {sources.data
          ?.filter((item) => matches(item.name))
          .map((item) => (
            <li key={`source:${item.id}`}>
              <SelectionDisclosure title={item.name}>
                <SourceSelection id={item.id} model={model} />
              </SelectionDisclosure>
            </li>
          ))}
      </Notebook.Materials>
      {sources.error && (
        <SessionReadError error={sources.error} retry={() => void sources.refetch()} />
      )}
      {documents.hasNextPage && (
        <Button
          disabled={documents.isFetchingNextPage}
          onClick={() => void documents.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </WorkspaceSurface.Section>
  );
}
function SelectionDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}</summary>
      {open && children}
    </details>
  );
}
function DocumentSelection({
  id,
  model
}: {
  id: StudyDocumentId;
  model: ReturnType<typeof useSelection>;
}) {
  const { t } = useI18n();
  const owner = useQuery(sessionDocumentOptions(id));
  const [selected, setSelected] = useState<StudyDocumentVersionId>();
  if (owner.error)
    return <SessionReadError error={owner.error} retry={() => void owner.refetch()} />;
  const version = owner.data?.version;
  return version ? (
    <>
      <DocumentInputHistory id={id} onSelect={setSelected} />
      <Candidate
        key={String(selected ?? version.id)}
        input={{ kind: 'document', versionId: selected ?? version.id }}
        model={model}
      />
    </>
  ) : (
    <Loading label={t('LoadingStudy')} />
  );
}
function DocumentInputHistory({
  id,
  onSelect
}: {
  id: StudyDocumentId;
  onSelect: (id: StudyDocumentVersionId | undefined) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const history = useInfiniteQuery({ ...documentHistoryOptions(id), enabled: open });
  return (
    <HistoryDisclosure
      open={open}
      onOpenChange={setOpen}
      onCurrent={() => onSelect(undefined)}
      error={
        history.error && (
          <SessionReadError error={history.error} retry={() => void history.refetch()} />
        )
      }
      more={
        history.hasNextPage
          ? { pending: history.isFetchingNextPage, load: () => void history.fetchNextPage() }
          : undefined
      }
    >
      {history.data?.pages
        .flatMap((page) => page.items)
        .filter((version) => version.status === 'published')
        .map((version) => (
          <Button key={String(version.id)} variant="ghost" onClick={() => onSelect(version.id)}>
            {t('ReaderVersion')} {String(version.number)}
          </Button>
        ))}
    </HistoryDisclosure>
  );
}
function SourceSelection({ id, model }: { id: SourceId; model: ReturnType<typeof useSelection> }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<{ revision: bigint; snapshotId: ContentSnapshotId }>();
  const source = useQuery(sourceExtractionOptions(id));
  const exact = selected ?? source.data;
  return (
    <>
      <SourceHistory sourceId={id} onSelect={setSelected} />
      {!selected && source.error && (
        <SessionReadError error={source.error} retry={() => void source.refetch()} />
      )}
      {exact ? (
        <Candidate
          key={`${exact.revision}:${exact.snapshotId}`}
          input={{
            kind: 'source',
            sourceId: id,
            revision: exact.revision,
            snapshotId: exact.snapshotId
          }}
          model={model}
        />
      ) : (
        !source.error && <Loading label={t('SessionPending')} />
      )}
    </>
  );
}
function Candidate({ input, model }: { input: Reference; model: ReturnType<typeof useSelection> }) {
  const key = selectionReferenceKey(input);
  return (
    <ExactSelection
      input={input}
      selected={model.current?.targets.find((item) => selectionReferenceKey(item.input) === key)}
      disabled={
        !model.current ||
        model.saving ||
        (!model.current.targets.some((item) => selectionReferenceKey(item.input) === key) &&
          model.current.targets.length >= 20)
      }
      change={model.change}
    />
  );
}
function ExactSelection({
  input,
  selected,
  disabled,
  change
}: {
  input: Reference;
  selected?: Target;
  disabled: boolean;
  change: (target: Target) => void;
}) {
  const { t } = useI18n();
  const exact = useQuery(selectedContentOptions(input));
  if (exact.error)
    return <SessionReadError error={exact.error} retry={() => void exact.refetch()} />;
  if (!exact.data) return <Loading label={t('LoadingStudy')} />;
  return (
    <SelectionContent
      input={input}
      selected={selected}
      disabled={disabled}
      change={change}
      content={exact.data}
    />
  );
}
function SelectionContent({
  input,
  selected,
  disabled,
  change,
  content
}: {
  input: Reference;
  selected?: Target;
  disabled: boolean;
  change: (target: Target) => void;
  content: { name: string; document: typeof documentSchema.Type };
}) {
  const { t } = useI18n();
  const [blockId, setBlockId] = useState('');
  const block = content.document.blocks.find((item) => item.id === blockId);
  return (
    <div>
      <p>
        {content.name} ·{' '}
        {input.kind === 'document' ? String(input.versionId) : String(input.revision)}
      </p>
      <Button
        disabled={disabled}
        aria-pressed={selected?.scope.kind === 'document'}
        onClick={() => change({ input, scope: { kind: 'document' } })}
      >
        {t('SessionWhole')}
      </Button>
      {content.document.blocks.map((item, index) => (
        <label key={item.id}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected?.scope.kind === 'blocks' && selected.scope.blockIds.includes(item.id)}
            onChange={(event) => {
              const current = selected?.scope.kind === 'blocks' ? selected.scope.blockIds : [];
              const blockIds = event.currentTarget.checked
                ? [...current, item.id]
                : current.filter((id) => id !== item.id);
              if (blockIds.length) change({ input, scope: { kind: 'blocks', blockIds } });
            }}
          />
          {index + 1} · {item.text.slice(0, 80)}
        </label>
      ))}
      <SelectControl
        label={t('DocumentBlock')}
        value={blockId}
        options={[
          { value: '', label: t('AnnotationChooseBlock') },
          ...content.document.blocks.map((item, index) => ({
            value: item.id,
            label: `${index + 1} · ${item.text.slice(0, 80)}`
          }))
        ]}
        onValueChange={setBlockId}
      />
      {block && (
        <label>
          {t('DocumentSelectPassage')}
          <Textarea
            readOnly
            value={block.text}
            disabled={disabled}
            onSelect={(event) => {
              const range = {
                blockId: block.id,
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd
              };
              if (range.end > range.start && validBlockTextRange(content.document, range))
                change({ input, scope: { kind: 'ranges', ranges: [range] } });
            }}
          />
        </label>
      )}
    </div>
  );
}

const scopeLabels = {
  document: 'SessionWhole',
  blocks: 'SessionBlocks',
  ranges: 'SessionRanges'
} as const;
function selectedVersion(target: Target, number: bigint | undefined) {
  if (number !== undefined) return number;
  return target.input.kind === 'source' ? target.input.revision : target.input.versionId;
}
/** A saved range summary never shows unselected surrounding content. */
export function SelectedTarget({ target }: { target: Target }) {
  const { t } = useI18n();
  const exact = useQuery(selectedContentOptions(target.input));
  const content = exact.isError ? undefined : exact.data;
  const excerpts = content ? selectedExcerpts(target, content.document) : undefined;
  return (
    <Notebook.SelectedTarget>
      {content && excerpts ? (
        <>
          <span>{content.name}</span>
          <Notebook.Muted>
            {t('ReaderVersion')} {String(selectedVersion(target, content.number))} ·{' '}
            {t(scopeLabels[target.scope.kind])} · {excerpts.length}
          </Notebook.Muted>
          {excerpts.map((text, index) => (
            <blockquote key={index}>{text}</blockquote>
          ))}
        </>
      ) : (
        <span>{t(exact.isPending ? 'LoadingStudy' : 'SessionReadUnavailable')}</span>
      )}
      {exact.error && <SessionReadError error={exact.error} retry={() => void exact.refetch()} />}
    </Notebook.SelectedTarget>
  );
}
function selectedExcerpts(target: Target, document: typeof documentSchema.Type) {
  if (target.scope.kind === 'ranges') {
    if (
      !target.scope.ranges.every(
        (range) => range.end > range.start && validBlockTextRange(document, range)
      )
    )
      return undefined;
    return target.scope.ranges.map((range) =>
      document.blocks
        .find((block) => block.id === range.blockId)!
        .text.slice(range.start, range.end)
    );
  }
  const scope = target.scope;
  const blocks = document.blocks.filter(
    (block) => scope.kind === 'document' || scope.blockIds.includes(block.id)
  );
  if (scope.kind === 'blocks' && blocks.length !== scope.blockIds.length) return undefined;
  return blocks.map((block) => block.text);
}
