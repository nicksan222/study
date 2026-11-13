import type { NoteId, SourceId } from '@study/contracts/ids';
import type { MessagePart } from '@study/contracts/notes/messages';
import type { Source } from '@study/contracts/sources/schemas';
import { mediaSize } from '@study/localization';
import { AttachmentPreview } from '@study/ui/attachment-preview';
import { ContextMenuItem } from '@study/ui/context-menu';
import { Notebook } from '@study/ui/note-workspace';
import { WorkspaceAttachments } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import {
  SourceDeletion,
  SourceVersionDeletion,
  sourceOptions as attachmentSourceOptions
} from '../source-library';
import { ArchiveMenuItem } from './archive-menu-item';
import { appearances } from './attachment-appearance';
import { useAttachmentMedia } from './attachment-cards.queries';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';
import type { ItemDeletionActions } from './item-deletion-menu';
import { notebookTargetId } from './notebook-index';
import { NoteReadError } from './status';

export function AttachmentCards({
  parts,
  onOpenSource,
  indexNoteId,
  noteId,
  compact = false
}: {
  parts: readonly MessagePart[];
  indexNoteId?: NoteId;
  noteId?: NoteId;
  compact?: boolean;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const Surface = compact ? WorkspaceAttachments.Rows : Desk.Attachments;

  return (
    <Surface>
      {parts.map((part) => (
        <AttachmentCard
          key={String(part.id)}
          part={part}
          onOpenSource={onOpenSource}
          indexNoteId={indexNoteId}
          noteId={noteId}
          compact={compact}
        />
      ))}
    </Surface>
  );
}

function AttachmentCard({
  part,
  onOpenSource,
  indexNoteId,
  noteId,
  compact = false
}: {
  part: MessagePart;
  indexNoteId?: NoteId;
  noteId?: NoteId;
  compact?: boolean;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const { t } = useI18n();
  const [deleted, setDeleted] = useState(false);
  const source = useQuery(attachmentSourceOptions(deleted ? null : part.sourceId));
  const { icon: Icon, tone } = appearances[part.sourceKind];

  const target = attachmentTarget({
    part,
    source: source.data,
    retry: () => void source.refetch(),
    failed: !!source.error,
    onOpenSource
  });
  const anchor = indexNoteId
    ? { id: notebookTargetId(indexNoteId, 'attachment', part.id), tabIndex: -1 }
    : {};
  const preview = ['image', 'video', 'audio'].includes(part.sourceKind) ? (
    <SourcePreview part={part} />
  ) : undefined;
  const card = compact ? (
    <WorkspaceAttachments.Item
      render={target}
      title={part.sourceName}
      label={part.sourceName}
      meta={<AttachmentMeta part={part} source={source.data} failed={source.isError} />}
      icon={<Icon aria-hidden="true" />}
      tone={tone}
    />
  ) : (
    <Notebook.IndexTarget {...anchor}>
      <Desk.AttachmentCard
        name={part.sourceName}
        meta={<AttachmentMeta part={part} source={source.data} failed={source.isError} />}
        icon={<Icon size={22} aria-hidden="true" />}
        tone={tone}
        preview={preview}
        render={target}
      />
      {source.error && <NoteReadError error={source.error} retry={() => void source.refetch()} />}
    </Notebook.IndexTarget>
  );

  return (
    <AttachmentContextMenu
      source={source.data}
      noteId={noteId}
      onDeleted={() => setDeleted(true)}
      target={target}
      disabled={!source.data && !source.error}
      label={t(source.error && !source.data ? 'Retry' : 'OpenMaterial')}
    >
      {card}
    </AttachmentContextMenu>
  );
}

function AttachmentContextMenu({
  source,
  noteId,
  onDeleted,
  target,
  disabled,
  label,
  children
}: {
  source?: Source;
  noteId?: NoteId;
  onDeleted: () => void;
  target: ReactElement<{ 'aria-label'?: string }>;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const menu = (actions?: ItemDeletionActions) => (
    <ItemContextMenu
      target={target}
      disabled={disabled}
      label={label}
      dialogOpen={actions?.open}
      actions={
        <>
          {source && (
            <ContextMenuItem
              render={<Link to="/sources/$sourceId" params={{ sourceId: String(source.id) }} />}
            >
              <ArrowUpRight aria-hidden="true" />
              {t('OpenInLibrary')}
            </ContextMenuItem>
          )}
          {source && noteId && (
            <ArchiveMenuItem noteId={noteId} target={{ kind: 'source', id: source.id }} />
          )}
          {actions && <ItemDeletionMenu {...actions} />}
        </>
      }
    >
      {children}
    </ItemContextMenu>
  );

  if (!source) return menu();

  return (
    <SourceDeletion
      source={source}
      onDeleted={() => {
        onDeleted();
        void cache.invalidateQueries({ queryKey: ['note-workspace'] });
      }}
      renderTrigger={(onDeleteItem, deleting) => (
        <SourceVersionDeletion
          source={source}
          onDeleted={() => {
            void cache.invalidateQueries({
              queryKey: ['sources', 'current-extraction', String(source.id)]
            });
          }}
          renderTrigger={(onDeleteVersion, deletingVersion) =>
            menu({ onDeleteItem, onDeleteVersion, open: deleting || deletingVersion })
          }
        />
      )}
    />
  );
}

function AttachmentMeta({
  part,
  source,
  failed
}: {
  part: MessagePart;
  source?: Source;
  failed: boolean;
}) {
  const { t, locale } = useI18n();
  const meta = [
    t(appearances[part.sourceKind].label),
    source ? mediaSize(locale, Number(source.sizeBytes)) : undefined
  ]
    .filter(Boolean)
    .join(' · ');

  if (source) return meta;

  return `${meta} · ${t(part.sourceId === null ? 'ReaderOriginalUnavailable' : failed ? 'Retry' : 'NotePending')}`;
}

function SourcePreview({ part }: { part: MessagePart }) {
  const { t } = useI18n();
  const kind = part.sourceKind;
  const enabled = kind === 'image' || kind === 'video' || kind === 'audio';
  const media = useAttachmentMedia(part.sourceId, enabled);

  if (!enabled) return null;

  return (
    <>
      <AttachmentPreview
        kind={kind}
        src={media.url}
        mime={media.data?.source.mime}
        label={part.sourceName}
        fallback={<span>{t(media.error ? 'ReaderOriginalUnavailable' : 'NotePending')}</span>}
      />
      {media.error && <NoteReadError error={media.error} retry={() => void media.refetch()} />}
    </>
  );
}

function attachmentTarget({
  part,
  source,
  retry,
  failed,
  onOpenSource
}: {
  part: MessagePart;
  source?: { id: SourceId; name: string };
  retry: () => void;
  failed: boolean;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  if (!source)
    return <button type="button" aria-label={part.sourceName} disabled={!failed} onClick={retry} />;

  if (onOpenSource)
    return (
      <button type="button" aria-label={part.sourceName} onClick={() => onOpenSource(source)} />
    );

  return <Link to="/sources/$sourceId" params={{ sourceId: String(source.id) }} />;
}
