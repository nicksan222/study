import type { MessagePart } from '@study/contracts/conversations/messages';
import type { SessionId, SourceId } from '@study/contracts/ids';
import type { Source } from '@study/contracts/sources/schemas';
import { mediaSize } from '@study/localization';
import { AttachmentPreview } from '@study/ui/attachment-preview';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceAttachments } from '@study/ui/workspace';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import {
  SourceDeletion,
  SourceVersionDeletion,
  sourceOptions as attachmentSourceOptions
} from '../source-library';
import { appearances } from './attachment-appearance';
import { useAttachmentMedia } from './attachment-cards.queries';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';
import type { ItemDeletionActions } from './item-deletion-menu';
import { notebookTargetId } from './notebook-index';
import { SessionReadError } from './status';

export function AttachmentCards({
  parts,
  onOpenSource,
  indexSessionId,
  compact = false
}: {
  parts: readonly MessagePart[];
  indexSessionId?: SessionId;
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
          indexSessionId={indexSessionId}
          compact={compact}
        />
      ))}
    </Surface>
  );
}

function AttachmentCard({
  part,
  onOpenSource,
  indexSessionId,
  compact = false
}: {
  part: MessagePart;
  indexSessionId?: SessionId;
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
  const card = compact ? (
    <WorkspaceAttachments.Item render={target} title={part.sourceName}>
      <Icon aria-hidden="true" />
      <span>{part.sourceName}</span>
    </WorkspaceAttachments.Item>
  ) : (
    <Notebook.IndexTarget
      id={indexSessionId ? notebookTargetId(indexSessionId, 'attachment', part.id) : undefined}
      tabIndex={indexSessionId ? -1 : undefined}
    >
      <Desk.AttachmentCard
        name={part.sourceName}
        meta={<AttachmentMeta part={part} source={source.data} failed={source.isError} />}
        icon={<Icon size={22} aria-hidden="true" />}
        tone={tone}
        preview={
          ['image', 'video', 'audio'].includes(part.sourceKind) ? (
            <SourcePreview part={part} />
          ) : undefined
        }
        render={target}
      />
      {source.error && (
        <SessionReadError error={source.error} retry={() => void source.refetch()} />
      )}
    </Notebook.IndexTarget>
  );

  return (
    <AttachmentContextMenu
      source={source.data}
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
  onDeleted,
  target,
  disabled,
  label,
  children
}: {
  source?: Source;
  onDeleted: () => void;
  target: ReactElement<{ 'aria-label'?: string }>;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  const cache = useQueryClient();
  const menu = (actions?: ItemDeletionActions) => (
    <ItemContextMenu
      target={target}
      disabled={disabled}
      label={label}
      dialogOpen={actions?.open}
      actions={actions && <ItemDeletionMenu {...actions} />}
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
        void cache.invalidateQueries({ queryKey: ['session-workspace'] });
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
  return `${meta} · ${t(part.sourceId === null ? 'ReaderOriginalUnavailable' : failed ? 'Retry' : 'SessionPending')}`;
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
        fallback={<span>{t(media.error ? 'ReaderOriginalUnavailable' : 'SessionPending')}</span>}
      />
      {media.error && <SessionReadError error={media.error} retry={() => void media.refetch()} />}
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
