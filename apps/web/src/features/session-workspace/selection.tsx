import type { sessionSelectionTargetSchema } from '@study/contracts/conversations/context';
import type { SessionId } from '@study/contracts/ids';
import type {
  MaterialSummaryDto,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Textarea } from '@study/ui/textarea';
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import {
  materialOptions,
  materialsOptions,
  versionOptions
} from '../material-library/material-library.queries';
import {
  exactDocumentOptions,
  materialSearchOptions,
  selectionOptions,
  updateSelection
} from './session-workspace.queries';
import type { Selection } from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';

type Target = typeof sessionSelectionTargetSchema.Type;
export function SelectionPanel({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const selected = useQuery(selectionOptions(id));
  const key = ['session-drafts', String(id), 'selection'];
  const draft = useQuery({
    queryKey: key,
    queryFn: () => null as Selection | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const [search, setSearch] = useState('');
  const results = useQuery(materialSearchOptions(search.trim()));
  const materials = useInfiniteQuery(materialsOptions());
  const current = draft.data ?? selected.data;
  const mutationKey = ['session-selection-save', String(id)];
  const saving = useIsMutating({ mutationKey, exact: true }) > 0;
  const save = useMutation({
    mutationKey,
    retry: false,
    mutationFn: (value: Selection) =>
      updateSelection({ sessionId: id, expectedRevision: value.revision, targets: value.targets }),
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
  return (
    <details className="session-section">
      <summary>{t('SessionSelection')}</summary>
      <p className="session-muted">{t('SessionSelectionHelp')}</p>
      {selected.isPending && <p role="status">{t('LoadingStudy')}</p>}
      {selected.error && (
        <SessionReadError error={selected.error} retry={() => void selected.refetch()} />
      )}
      <ul className="session-selected">
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
      </ul>
      {current?.targets.length === 0 && <p className="session-muted">{t('SessionNoSelection')}</p>}
      <div className="session-actions">
        <Button disabled={!draft.data || saving} onClick={() => current && save.mutate(current)}>
          {t('SessionSaveSelection')}
        </Button>
        {draft.data && (
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              cache.setQueryData(key, null);
              save.reset();
              void selected.refetch();
            }}
          >
            {t('SessionReloadSelection')}
          </Button>
        )}
      </div>
      {save.error && <SessionError error={save.error} />}
      {draft.data && <p role="status">{t('SessionSelectionUnsaved')}</p>}
      <Input
        aria-label={t('SessionSearchMaterial')}
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
      <ul className="session-materials">
        {materials.data?.pages
          .flatMap((page) => page.items)
          .map((material) => (
            <li key={String(material.id)}>
              <MaterialChoice
                material={material}
                selected={current?.targets.find((item) => item.versionId === material.version.id)}
                disabled={
                  !current ||
                  saving ||
                  (!current.targets.some((item) => item.versionId === material.version.id) &&
                    current.targets.length >= 20)
                }
                change={change}
              />
            </li>
          ))}
      </ul>
      {materials.hasNextPage && (
        <Button
          variant="ghost"
          disabled={materials.isFetchingNextPage}
          onClick={() => void materials.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </details>
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
      {open && version.isPending && <p role="status">{t('LoadingStudy')}</p>}
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
  const exact = useQuery(exactDocumentOptions(version.id));
  if (exact.isPending) return <p role="status">{t('LoadingStudy')}</p>;
  if (exact.isError || !exact.data)
    return <SessionReadError error={exact.error} retry={() => void exact.refetch()} />;
  const { document, id: documentId } = exact.data;
  return (
    <div className="session-exact-document">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => change({ versionId: version.id, documentId, scope: { kind: 'document' } })}
      >
        {t('SessionUseWhole')}
      </Button>
      {!documentId && <p className="session-muted">{t('SessionRangeUnavailable')}</p>}
      {document.blocks.map((block) => (
        <div key={block.id} className="session-block">
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
            useRange={(start, end) => {
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
        </div>
      ))}
    </div>
  );
}
function BlockRange({
  text,
  disabled,
  useRange
}: {
  text: string;
  disabled: boolean;
  useRange: (start: number, end: number) => void;
}) {
  const { t } = useI18n();
  const [range, setRange] = useState({ start: 0, end: 0 });
  return (
    <>
      <Textarea
        aria-label={t('SessionPassage')}
        readOnly
        value={text}
        className="session-block-text"
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
        onClick={() => useRange(range.start, range.end)}
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
  id: import('@study/contracts/ids').MaterialVersionId;
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
    <div className="session-selected-target">
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
    </div>
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
  const exact = useQuery(exactDocumentOptions(target.versionId));
  const scope = target.scope;
  const document =
    !exact.isError && exact.data && (!target.documentId || target.documentId === exact.data.id)
      ? exact.data.document
      : undefined;
  const excerpts = document
    ? scope.kind === 'blocks'
      ? scope.blockIds.map((id) => document.blocks.find((block) => block.id === id)?.text)
      : scope.kind === 'ranges'
        ? scope.ranges.map((range) =>
            range.versionId === target.versionId && range.documentId === exact.data?.id
              ? document.blocks
                  .find((block) => block.id === range.blockId)
                  ?.text.slice(range.start, range.end)
              : undefined
          )
        : []
    : [];
  return (
    <>
      <strong>
        {material.data?.title ?? t(material.isPending ? 'LoadingStudy' : 'SessionReadUnavailable')}
      </strong>
      <span className="session-muted">
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
      </span>
      {scope.kind !== 'document' && (
        <div className="session-selection-excerpts">
          {document ? (
            excerpts.map((text, index) => (
              <blockquote key={index}>{text ?? t('SessionReadUnavailable')}</blockquote>
            ))
          ) : (
            <p>{t(exact.isPending ? 'LoadingStudy' : 'SessionReadUnavailable')}</p>
          )}
        </div>
      )}
      {material.error && (
        <SessionReadError error={material.error} retry={() => void material.refetch()} />
      )}
      {exact.error && <SessionReadError error={exact.error} retry={() => void exact.refetch()} />}
    </>
  );
}
