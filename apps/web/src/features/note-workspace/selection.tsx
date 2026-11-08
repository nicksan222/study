import type { noteSelectionTargetSchema } from '@study/contracts/notes/context';
import { validBlockTextRange } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Notebook } from '@study/ui/note-workspace';
import { SelectionSurface } from '@study/ui/selection';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { selectedContentOptions } from './selection.queries';
import { NoteReadError } from './status';

type Target = typeof noteSelectionTargetSchema.Type;

const scopeLabels = {
  document: 'NoteWhole',
  blocks: 'NoteBlocks',
  ranges: 'NoteRanges'
} as const;

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
                ? 'NoteSelectionPassageCount'
                : 'NoteSelectionBlockCount',
              { count: excerpts.length }
            )}
          </Notebook.Muted>
          <SelectionSurface.Excerpt>
            {excerpts.slice(0, 1).map(({ key, text }) => (
              <blockquote key={key}>{text}</blockquote>
            ))}
          </SelectionSurface.Excerpt>
          {excerpts.length > 0 && (
            <SelectionDisclosure title={t('NoteSelectionReadContent')}>
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
          <span>{t(exact.isPending ? 'LoadingStudy' : 'NoteReadUnavailable')}</span>
          {action}
        </SelectionSurface.Heading>
      )}
      {exact.error && <NoteReadError error={exact.error} retry={() => void exact.refetch()} />}
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
