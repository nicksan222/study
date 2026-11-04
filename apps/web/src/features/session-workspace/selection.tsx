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
import { SelectionSurface } from '@study/ui/selection';
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
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import {
  documentHistoryOptions,
  documentsOptions
} from '#web/lib/study-client/documents.queries.ts';

import { HistoryDisclosure } from '../document-presentation';
import { SourceHistory, sourceExtractionOptions } from '../source-library';
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
  const { selected, current } = model;

  return (
    <WorkspaceSurface.Section>
      <SelectionSurface.Root>
        <Notebook.Muted>{t('SessionSelectionGuide')}</Notebook.Muted>
        {selected.isPending && !current && <Loading label={t('LoadingStudy')} />}
        {selected.error && (
          <SessionReadError error={selected.error} retry={() => void selected.refetch()} />
        )}
        <IncludedSelection model={model} />
        <SelectionSave model={model} />
        <SelectionCatalog model={model} />
      </SelectionSurface.Root>
    </WorkspaceSurface.Section>
  );
}

type SelectionModel = ReturnType<typeof useSelection>;

function IncludedSelection({ model }: { model: SelectionModel }) {
  const { t } = useI18n();
  const { current, saving, change } = model;
  const includedId = useId();
  const includedHeading = useRef<HTMLHeadingElement>(null);

  if (!current) return null;

  return (
    <section aria-labelledby={includedId}>
      <SelectionSurface.Heading>
        <h3 id={includedId} ref={includedHeading} tabIndex={-1}>
          {t('SessionSelectionIncluded')}
        </h3>
        <Notebook.MutedLabel>
          {t('SessionSelectionCapacity', { count: current.targets.length })}
        </Notebook.MutedLabel>
      </SelectionSurface.Heading>
      {current.targets.length ? (
        <SelectionSurface.Included>
          {current.targets.map((target) => (
            <li key={selectionReferenceKey(target.input)}>
              <SelectedTarget
                target={target}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      change(target, true);
                      includedHeading.current?.focus();
                    }}
                  >
                    {t('SessionRemove')}
                  </Button>
                }
              />
            </li>
          ))}
        </SelectionSurface.Included>
      ) : (
        <SelectionSurface.Empty>
          <strong>{t('SessionSelectionEmptyTitle')}</strong>
          <Notebook.Muted>{t('SessionSelectionEmptyHelp')}</Notebook.Muted>
        </SelectionSurface.Empty>
      )}
    </section>
  );
}

function SelectionSave({ model }: { model: SelectionModel }) {
  const { t } = useI18n();
  const { current, saving, save, draft } = model;

  return (
    <SelectionSurface.Save aria-busy={saving}>
      <SelectionSurface.SaveActions>
        <Button disabled={!draft.data || saving} onClick={() => current && save.mutate(current)}>
          {t('SessionSaveSelection')}
        </Button>
        {draft.data && (
          <Button variant="ghost" size="sm-multiline" disabled={saving} onClick={model.reload}>
            {t('SessionReloadSelection')}
          </Button>
        )}
      </SelectionSurface.SaveActions>
      {save.error && <SessionError error={save.error} />}
      {draft.data && (
        <Notebook.Status role="status">{t('SessionSelectionUnsaved')}</Notebook.Status>
      )}
    </SelectionSurface.Save>
  );
}

function useSelectionCatalog() {
  const [search, setSearch] = useState('');
  const documents = useInfiniteQuery(documentsOptions());
  const sources = useQuery(selectionSourcesOptions());
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const matchingDocuments =
    documents.data?.pages.flatMap((page) => page.items).filter((item) => matches(item.title)) ?? [];
  const matchingSources = sources.data?.filter((item) => matches(item.name)) ?? [];
  const searchId = useId();
  const catalogPending = documents.isPending || sources.isPending;
  const catalogFailed = documents.isError || sources.isError;

  const catalogEmpty = [
    catalogPending,
    catalogFailed,
    matchingDocuments.length,
    matchingSources.length
  ].every((value) => !value);

  return {
    search,
    setSearch,
    searchId,
    documents,
    sources,
    matchingDocuments,
    matchingSources,
    catalogPending,
    catalogEmpty
  };
}

function SelectionCatalog({ model }: { model: SelectionModel }) {
  const { t } = useI18n();
  const { current } = model;
  const {
    search,
    setSearch,
    searchId,
    documents,
    sources,
    matchingDocuments,
    matchingSources,
    catalogPending,
    catalogEmpty
  } = useSelectionCatalog();

  return (
    <SelectionSurface.Catalog>
      <h3>{t('SessionSelectionAddMaterial')}</h3>
      <label htmlFor={searchId}>{t('SessionSearchMaterial')}</label>
      <Input
        id={searchId}
        type="search"
        value={search}
        maxLength={1000}
        onValueChange={setSearch}
      />
      <SelectionCapacityNotice current={current} />
      {catalogPending && <Loading label={t('LoadingStudy')} />}
      {documents.error && (
        <SessionReadError error={documents.error} retry={() => void documents.refetch()} />
      )}
      {!!matchingDocuments.length && (
        <MaterialGroup title={t('SessionSelectionDocuments')} count={matchingDocuments.length}>
          {matchingDocuments.map((item) => (
            <li key={`document:${item.id}`}>
              <SelectionDisclosure title={item.title}>
                <DocumentSelection id={item.id} model={model} />
              </SelectionDisclosure>
            </li>
          ))}
        </MaterialGroup>
      )}
      {!!matchingSources.length && (
        <MaterialGroup title={t('SessionSelectionSources')} count={matchingSources.length}>
          {matchingSources.map((item) => (
            <li key={`source:${item.id}`}>
              <SelectionDisclosure title={item.name}>
                <SourceSelection id={item.id} model={model} />
              </SelectionDisclosure>
            </li>
          ))}
        </MaterialGroup>
      )}
      {catalogEmpty && (
        <Notebook.Status role="status">
          {t(search.trim() ? 'SessionSelectionNoMatches' : 'SessionSelectionLibraryEmpty')}
        </Notebook.Status>
      )}
      {sources.error && (
        <SessionReadError error={sources.error} retry={() => void sources.refetch()} />
      )}
      {documents.hasNextPage && (
        <Button
          variant="outline"
          disabled={documents.isFetchingNextPage}
          onClick={() => void documents.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </SelectionSurface.Catalog>
  );
}

function SelectionCapacityNotice({ current }: { current: SelectionModel['current'] }) {
  const { t } = useI18n();

  if (!current || current.targets.length < 20) return null;

  return <Notebook.Status role="status">{t('SessionSelectionLimit')}</Notebook.Status>;
}

function MaterialGroup({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <SelectionSurface.Group>
      <SelectionSurface.Heading>
        <h4>{title}</h4>
        <Notebook.MutedLabel>{count}</Notebook.MutedLabel>
      </SelectionSurface.Heading>
      <SelectionSurface.Materials>{children}</SelectionSurface.Materials>
    </SelectionSurface.Group>
  );
}

function SelectionDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <SelectionSurface.Disclosure
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && <SelectionSurface.Editor>{children}</SelectionSurface.Editor>}
    </SelectionSurface.Disclosure>
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
  change: (target: Target, remove?: boolean) => void;
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

export function SelectionContent({
  input,
  selected,
  disabled,
  change,
  content
}: {
  input: Reference;
  selected?: Target;
  disabled: boolean;
  change: (target: Target, remove?: boolean) => void;
  content: { name: string; document: typeof documentSchema.Type };
}) {
  const { t } = useI18n();
  const [blockId, setBlockId] = useState('');
  const [range, setRange] =
    useState<Extract<Target['scope'], { kind: 'ranges' }>['ranges'][number]>();
  const [showAll, setShowAll] = useState(false);
  const block = content.document.blocks.find((item) => item.id === blockId);
  const blocksId = useId();
  const visibleBlocks = showAll
    ? content.document.blocks
    : content.document.blocks.filter(
        (item, index) =>
          index < 3 ||
          (selected?.scope.kind === 'blocks' && selected.scope.blockIds.includes(item.id))
      );
  const blocksSelected = selected?.scope.kind === 'blocks' ? selected.scope.blockIds.length : 0;

  return (
    <SelectionSurface.Content>
      <SelectionSurface.Heading>
        <strong>{content.name}</strong>
        <Button
          variant={selected?.scope.kind === 'document' ? 'secondary' : 'outline'}
          disabled={disabled}
          aria-pressed={selected?.scope.kind === 'document'}
          onClick={() => change({ input, scope: { kind: 'document' } })}
        >
          {t('SessionWhole')}
        </Button>
      </SelectionSurface.Heading>
      <fieldset disabled={disabled}>
        <legend>{t('SessionSelectionChooseBlocks', { count: blocksSelected })}</legend>
        <SelectionSurface.Blocks id={blocksId}>
          {visibleBlocks.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={
                    disabled ||
                    (blocksSelected >= 200 &&
                      !(
                        selected?.scope.kind === 'blocks' &&
                        selected.scope.blockIds.includes(item.id)
                      ))
                  }
                  checked={
                    selected?.scope.kind === 'blocks' && selected.scope.blockIds.includes(item.id)
                  }
                  onChange={(event) => {
                    const current =
                      selected?.scope.kind === 'blocks' ? selected.scope.blockIds : [];
                    const blockIds = event.currentTarget.checked
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id);

                    if (blockIds.length) change({ input, scope: { kind: 'blocks', blockIds } });
                    else if (selected) change(selected, true);
                  }}
                />
                <span>
                  {content.document.blocks.indexOf(item) + 1} · {item.text.slice(0, 160)}
                </span>
              </label>
            </li>
          ))}
        </SelectionSurface.Blocks>
        {content.document.blocks.length > 3 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showAll}
            aria-controls={blocksId}
            onClick={() => setShowAll(!showAll)}
          >
            {t(showAll ? 'SessionSelectionFewerBlocks' : 'SessionSelectionAllBlocks', {
              count: content.document.blocks.length
            })}
          </Button>
        )}
      </fieldset>
      <SelectionSurface.Disclosure>
        <summary>{t('SessionSelectionChoosePassage')}</summary>
        <SelectionSurface.Content>
          <Notebook.Muted>{t('SessionSelectionPassageHelp')}</Notebook.Muted>
          <SelectControl
            label={t('DocumentBlock')}
            disabled={disabled}
            value={blockId}
            options={[
              { value: '', label: t('AnnotationChooseBlock') },
              ...content.document.blocks.map((item, index) => ({
                value: item.id,
                label: `${index + 1} · ${item.text.slice(0, 80)}`
              }))
            ]}
            onValueChange={(value) => {
              setBlockId(value);
              setRange(undefined);
            }}
          />
          {block && (
            <label>
              {t('DocumentSelectPassage')}
              <Textarea
                readOnly
                value={block.text}
                disabled={disabled}
                onSelect={(event) => {
                  const next = {
                    blockId: block.id,
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd
                  };

                  setRange(
                    next.end > next.start && validBlockTextRange(content.document, next)
                      ? next
                      : undefined
                  );
                }}
              />
            </label>
          )}
          <Button
            variant="outline"
            disabled={disabled || !range}
            onClick={() => range && change({ input, scope: { kind: 'ranges', ranges: [range] } })}
          >
            {t('SessionUseRange')}
          </Button>
        </SelectionSurface.Content>
      </SelectionSurface.Disclosure>
    </SelectionSurface.Content>
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

export function SelectedTarget({ target, action }: { target: Target; action?: ReactNode }) {
  const { t } = useI18n();
  const exact = useQuery(selectedContentOptions(target.input));
  const content = exact.isError ? undefined : exact.data;
  const excerpts = content ? selectedExcerpts(target, content.document) : undefined;

  return (
    <Notebook.SelectedTarget>
      {content && excerpts ? (
        <>
          <SelectionSurface.Heading>
            <strong>{content.name}</strong>
            {action}
          </SelectionSurface.Heading>
          <Notebook.Muted>
            {t('ReaderVersion')} {String(selectedVersion(target, content.number))} ·{' '}
            {t(scopeLabels[target.scope.kind])} ·{' '}
            {t(
              target.scope.kind === 'ranges'
                ? 'SessionSelectionPassageCount'
                : 'SessionSelectionBlockCount',
              { count: excerpts.length }
            )}
          </Notebook.Muted>
          <SelectionSurface.Excerpt>
            {excerpts.slice(0, 1).map(({ key, text }) => (
              <blockquote key={key}>{text}</blockquote>
            ))}
          </SelectionSurface.Excerpt>
          {excerpts.length > 0 && (
            <SelectionDisclosure title={t('SessionSelectionReadContent')}>
              <SelectionSurface.FullContent tabIndex={0}>
                {excerpts.map(({ key, text }) => (
                  <blockquote key={key}>{text}</blockquote>
                ))}
              </SelectionSurface.FullContent>
            </SelectionDisclosure>
          )}
        </>
      ) : (
        <SelectionSurface.Heading>
          <span>{t(exact.isPending ? 'LoadingStudy' : 'SessionReadUnavailable')}</span>
          {action}
        </SelectionSurface.Heading>
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

    return target.scope.ranges.map((range) => ({
      key: `${range.blockId}:${range.start}:${range.end}`,
      text: document.blocks
        .find((block) => block.id === range.blockId)!
        .text.slice(range.start, range.end)
    }));
  }

  const scope = target.scope;
  const blocks = document.blocks.filter(
    (block) => scope.kind === 'document' || scope.blockIds.includes(block.id)
  );

  if (scope.kind === 'blocks' && blocks.length !== scope.blockIds.length) return undefined;

  return blocks.map((block) => ({ key: block.id, text: block.text }));
}
