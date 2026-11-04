import type { MessagePart } from '@study/contracts/conversations/messages';
import type { SessionId, SourceId } from '@study/contracts/ids';
import { mediaSize } from '@study/localization';
import { AttachmentPreview } from '@study/ui/attachment-preview';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceAttachments } from '@study/ui/workspace';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';

import { sourceOptions as attachmentSourceOptions } from '../source-library';
import { appearances } from './attachment-appearance';
import { useAttachmentMedia } from './attachment-cards.queries';
import { ItemContextMenu } from './item-context-menu';
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
  const { t, locale } = useI18n();
  const source = useQuery(attachmentSourceOptions(part.sourceId));
  const { icon: Icon, label, tone } = appearances[part.sourceKind];
  const meta = [
    t(label),
    source.data ? mediaSize(locale, Number(source.data.sizeBytes)) : undefined
  ]
    .filter(Boolean)
    .join(' · ');

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
        meta={
          source.data
            ? meta
            : `${meta} · ${t(part.sourceId === null ? 'ReaderOriginalUnavailable' : source.error ? 'Retry' : 'SessionPending')}`
        }
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
    <ItemContextMenu
      target={target}
      disabled={!source.data && !source.error}
      label={t(source.error && !source.data ? 'Retry' : 'OpenMaterial')}
    >
      {card}
    </ItemContextMenu>
  );
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
