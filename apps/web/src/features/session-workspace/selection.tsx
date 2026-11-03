import type { sessionSelectionTargetSchema } from '@study/contracts/conversations/context';
import type { SessionId, MaterialVersionId } from '@study/contracts/ids';
import type {
  MaterialSummaryDto,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { materialOptions, materialsOptions, versionOptions } from '../material-library';
import { selectionDraftOptions, saveSelectionOptions } from './selection.queries';
import {
  sessionDocumentOptions,
  sessionMaterialSearchOptions,
  selectionOptions
} from './session-workspace.queries';
import type { Selection } from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';

type Target = typeof sessionSelectionTargetSchema.Type;

function useSelection(id: SessionId) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const selected = useQuery(selectionOptions(id));
  const key = ['session-drafts', String(id), 'selection'];
  const draft = useQuery(selectionDraftOptions(id));
  const [search, setSearch] = useState('');
  const results = useQuery(sessionMaterialSearchOptions(search.trim()));
  const materials = useInfiniteQuery(materialsOptions());
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
      cache.setQueryData<Selection | null>(key, (previous) => {
        if (previous === submitted) return null;

        if (previous && previous.revision === submitted.revision)
          return { ...previous, revision: value.revision };

        return previous;
      });
    }
  });

  function change(target: Target, remove = false) {
    if (!current || saving) return;

    const rest = current.targets.filter((item) => item.versionId !== target.versionId);

    cache.setQueryData(key, {
      revision: current.revision,
      targets: remove ? rest : [...rest, target]
    });
    save.reset();
  }

  return {
    t,
    selected,
    draft,
    search,
    setSearch,
    results,
    materials,
    current,
    saving,
    save,
    cache,
    key,
    change
  };
}

/** Composes exact document, block and excerpt selection for the active session. */
export function SelectionPanel({ id }: { id: SessionId }) {
  const {
    t,
    selected,
    draft,
    search,
    setSearch,
    results,
    materials,
    current,
    saving,
    save,
    cache,
    key,
    change
  } = useSelection(id);

  return (
    <WorkspaceSurface.Section>
      <Notebook.Muted>{t('SessionSelectionHelp')}</Notebook.Muted>
      {selected.isPending && <Loading label={t('LoadingStudy')} />}
      {selected.error && (
        <SessionReadError error={selected.error} retry={() => void selected.refetch()} />
      )}
      <SelectedTargets current={current} saving={saving} change={change} />
      <SelectionSave
        dirty={!!draft.data}
        saving={saving}
        onSave={() => current && save.mutate(current)}
        onReload={() => {
          cache.setQueryData(key, null);
          save.reset();
          void selected.refetch();
        }}
      />
      {save.error && <SessionError error={save.error} />}
      {draft.data && <p role="status">{t('SessionSelectionUnsaved')}</p>}
      <Input
        aria-label={t('SessionSearchMaterial')}
        placeholder={t('SessionSearchMaterial')}
        maxLength={1000}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {results.error && (
        <SessionReadError error={results.error} retry={() => void results.refetch()} />
      )}
      {results.data?.hits.map((hit) => (
        <details key={String(hit.target.versionId)}>
          <summary>{hit.title}</summary>
          <SearchDocument
            id={hit.target.versionId}
            selected={current?.targets.find((target) => target.versionId === hit.target.versionId)}
            disabled={!current || saving || current.targets.length >= 20}
            change={change}
          />
        </details>
      ))}
      {materials.error && (
        <SessionReadError error={materials.error} retry={() => void materials.refetch()} />
      )}
      <Notebook.Materials>
        {materials.data?.pages
          .flatMap((page) => page.items)
          .map((material) => (
            <SelectionMaterial
              key={String(material.id)}
              material={material}
              current={current}
              saving={saving}
              change={change}
            />
          ))}
      </Notebook.Materials>
      {materials.hasNextPage && (
        <Button
          variant="ghost"
          disabled={materials.isFetchingNextPage}
          onClick={() => void materials.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </WorkspaceSurface.Section>
  );
}

function MaterialChoice({
  material,
  selected,
  disabled,
  change
}: {
  material: MaterialSummaryDto;
  selected?: Target;
  disabled: boolean;
  change: (target: Target, remove?: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const version = useQuery({ ...versionOptions(material.version.id), enabled: open });

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {material.title} · {t('ReaderVersion')} {String(material.version.number)}
      </summary>
      {open && version.isPending && <Loading label={t('LoadingStudy')} />}
      {version.error && (
        <SessionReadError error={version.error} retry={() => void version.refetch()} />
      )}
      {version.data && !version.isError && (
        <ExactDocument
          version={version.data}
          selected={selected}
          disabled={disabled}
          change={change}
        />
      )}
    </details>
  );
}

function ExactDocument({
  version,
  selected,
  disabled,
  change
}: {
  version: MaterialVersionDetailDto;
  selected?: Target;
  disabled: boolean;
  change: (target: Target) => void;
}) {
  const { t } = useI18n();
  const exact = useQuery(sessionDocumentOptions(version.id));

  if (exact.isPending) return <Loading label={t('LoadingStudy')} />;

  if (exact.isError || !exact.data)
    return <SessionReadError error={exact.error} retry={() => void exact.refetch()} />;

  const { document, id: documentId } = exact.data;

  return (
    <Notebook.ExactDocument>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => change({ versionId: version.id, documentId, scope: { kind: 'document' } })}
      >
        {t('SessionUseWhole')}
      </Button>
      {!documentId && <Notebook.Muted>{t('SessionRangeUnavailable')}</Notebook.Muted>}
      {document.blocks.map((block) => (
        <Notebook.Block key={block.id}>
          <Button
            size="sm"
            aria-pressed={
              selected?.scope.kind === 'blocks' && selected.scope.blockIds.includes(block.id)
            }
            variant={
              selected?.scope.kind === 'blocks' && selected.scope.blockIds.includes(block.id)
                ? 'secondary'
                : 'ghost'
            }
            disabled={disabled}
            onClick={() => {
              const previous = selected?.scope.kind === 'blocks' ? selected.scope.blockIds : [];
              const blockIds = previous.includes(block.id)
                ? previous.filter((id) => id !== block.id)
                : [...previous, block.id];

              if (blockIds.length > 0 && blockIds.length <= 200)
                change({ versionId: version.id, documentId, scope: { kind: 'blocks', blockIds } });
            }}
          >
            {t('SessionUseBlock')} · {block.id}
          </Button>
          <BlockRange
            text={block.text}
            disabled={disabled || !documentId}
            onUseRange={(start, end) => {
              if (documentId)
                change({
                  versionId: version.id,
                  documentId,
                  scope: {
                    kind: 'ranges',
                    ranges: [{ versionId: version.id, documentId, blockId: block.id, start, end }]
                  }
                });
            }}
          />
        </Notebook.Block>
      ))}
    </Notebook.ExactDocument>
  );
}

function BlockRange({
  text,
  disabled,
  onUseRange
}: {
  text: string;
  disabled: boolean;
  onUseRange: (start: number, end: number) => void;
}) {
  const { t } = useI18n();
  const [range, setRange] = useState({ start: 0, end: 0 });

  return (
    <>
      <Notebook.BlockText
        aria-label={t('SessionPassage')}
        readOnly
        value={text}
        onSelect={(event) =>
          setRange({
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd
          })
        }
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || range.end <= range.start}
        onClick={() => onUseRange(range.start, range.end)}
      >
        {t('SessionUseRange')}
      </Button>
    </>
  );
}

function SearchDocument({
  id,
  selected,
  disabled,
  change
}: {
  id: MaterialVersionId;
  selected?: Target;
  disabled: boolean;
  change: (target: Target) => void;
}) {
  const state = useQuery(versionOptions(id));

  if (state.isError)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;

  return state.data ? (
    <ExactDocument version={state.data} selected={selected} disabled={disabled} change={change} />
  ) : null;
}

export function SelectedTarget({ target }: { target: Target }) {
  const { t } = useI18n();
  const version = useQuery(versionOptions(target.versionId));

  return (
    <Notebook.SelectedTarget>
      {version.data && !version.isError ? (
        <SelectedVersion target={target} version={version.data} />
      ) : (
        <span>
          {t(version.isPending ? 'LoadingStudy' : 'SessionReadUnavailable')} · {t('ReaderVersion')}{' '}
          {String(target.versionId)}
        </span>
      )}
      {version.error && (
        <SessionReadError error={version.error} retry={() => void version.refetch()} />
      )}
    </Notebook.SelectedTarget>
  );
}

function SelectedVersion({
  target,
  version
}: {
  target: Target;
  version: MaterialVersionDetailDto;
}) {
  const { t } = useI18n();
  const material = useQuery(materialOptions(version.material_id));
  const exact = useQuery(sessionDocumentOptions(target.versionId));
  const document =
    !exact.isError && exact.data && matchesDocument(target, exact.data.id)
      ? exact.data.document
      : undefined;
  const excerpts = selectionExcerpts(target, document, exact.data?.id);

  return (
    <>
      <strong>
        {material.data?.title ?? t(material.isPending ? 'LoadingStudy' : 'SessionReadUnavailable')}
      </strong>
      <SelectedScope target={target} version={version} />
      <SelectedExcerpts
        target={target}
        document={document}
        excerpts={excerpts}
        pending={exact.isPending}
      />
      {material.error && (
        <SessionReadError error={material.error} retry={() => void material.refetch()} />
      )}
      {exact.error && <SessionReadError error={exact.error} retry={() => void exact.refetch()} />}
    </>
  );
}

function selectionExcerpts(
  target: Target,
  document:
    | Awaited<
        ReturnType<
          Exclude<ReturnType<typeof sessionDocumentOptions>['queryFn'], undefined | symbol>
        >
      >['document']
    | undefined,
  documentId: Target['documentId']
) {
  const scope = target.scope;

  return document
    ? scope.kind === 'blocks'
      ? scope.blockIds.map((id) => ({
          key: id,
          text: document.blocks.find((block) => block.id === id)?.text
        }))
      : scope.kind === 'ranges'
        ? scope.ranges.map((range) => ({
            key: `${range.versionId}:${range.documentId}:${range.blockId}:${range.start}:${range.end}`,
            text:
              range.versionId === target.versionId && range.documentId === documentId
                ? document.blocks
                    .find((block) => block.id === range.blockId)
                    ?.text.slice(range.start, range.end)
                : undefined
          }))
        : []
    : [];
}

function SelectedScope({ target, version }: { target: Target; version: MaterialVersionDetailDto }) {
  const { t } = useI18n();
  const scope = target.scope;

  return (
    <Notebook.MutedLabel>
      {t('ReaderVersion')} {String(version.number)} ·{' '}
      {t(
        scope.kind === 'document'
          ? 'SessionWhole'
          : scope.kind === 'blocks'
            ? 'SessionBlocks'
            : 'SessionRanges'
      )}
      {scope.kind !== 'document' &&
        ` · ${scope.kind === 'blocks' ? scope.blockIds.length : scope.ranges.length}`}
    </Notebook.MutedLabel>
  );
}

function materialChoiceDisabled(
  current: Selection | null | undefined,
  saving: boolean,
  versionId: Target['versionId']
) {
  if (!current || saving) return true;

  return (
    !current.targets.some((item) => item.versionId === versionId) && current.targets.length >= 20
  );
}

function matchesDocument(target: Target, documentId: Target['documentId']) {
  return !target.documentId || target.documentId === documentId;
}

function SelectedExcerpts({
  target,
  document,
  excerpts,
  pending
}: {
  target: Target;
  document: unknown;
  excerpts: { key: string; text: string | undefined }[];
  pending: boolean;
}) {
  const { t } = useI18n();
  const scope = target.scope;

  return (
    <>
      {scope.kind !== 'document' && (
        <Notebook.SelectionExcerpts>
          {document ? (
            excerpts.map(({ key, text }) => (
              <blockquote key={key}>{text ?? t('SessionReadUnavailable')}</blockquote>
            ))
          ) : (
            <p>{t(pending ? 'LoadingStudy' : 'SessionReadUnavailable')}</p>
          )}
        </Notebook.SelectionExcerpts>
      )}
    </>
  );
}

function SelectionMaterial({
  material,
  current,
  saving,
  change
}: {
  material: MaterialSummaryDto;
  current: Selection | null | undefined;
  saving: boolean;
  change: (target: Target, remove?: boolean) => void;
}) {
  return (
    <li key={String(material.id)}>
      <MaterialChoice
        material={material}
        selected={current?.targets.find((item) => item.versionId === material.version.id)}
        disabled={materialChoiceDisabled(current, saving, material.version.id)}
        change={change}
      />
    </li>
  );
}

function SelectedTargets({
  current,
  saving,
  change
}: {
  current: Selection | null | undefined;
  saving: boolean;
  change: (target: Target, remove?: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <Notebook.Selected>
        {current?.targets.map((target) => (
          <li key={String(target.versionId)}>
            <SelectedTarget target={target} />
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => change(target, true)}
            >
              {t('SessionRemove')}
            </Button>
          </li>
        ))}
      </Notebook.Selected>
      {current?.targets.length === 0 && <Notebook.Muted>{t('SessionNoSelection')}</Notebook.Muted>}
    </>
  );
}

function SelectionSave({
  dirty,
  saving,
  onSave,
  onReload
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReload: () => void;
}) {
  const { t } = useI18n();

  return (
    <Notebook.Actions>
      <Button disabled={!dirty || saving} onClick={onSave}>
        {t('SessionSaveSelection')}
      </Button>
      {dirty && (
        <Button variant="ghost" disabled={saving} onClick={onReload}>
          {t('SessionReloadSelection')}
        </Button>
      )}
    </Notebook.Actions>
  );
}
