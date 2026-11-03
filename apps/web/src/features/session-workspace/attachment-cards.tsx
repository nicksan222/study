import type { MessagePart } from '@study/contracts/conversations/messages';
import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { mediaSize } from '@study/localization';
import { AttachmentPreview } from '@study/ui/attachment-preview';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';
import { appearances } from './attachment-appearance';
import { attachmentSourceOptions, useAttachmentMedia } from './attachment-cards.queries';
import { SessionReadError } from './status';
import { attachmentPreviewOptions } from './workspace-context.queries';

export function AttachmentCards({
  parts,
  onOpenDocument
}: {
  parts: readonly MessagePart[];
  onOpenDocument?: (material: MaterialSummaryDto) => void;
}) {
  return (
    <Desk.Attachments>
      {parts.map((part) => (
        <AttachmentCard key={String(part.id)} part={part} onOpenDocument={onOpenDocument} />
      ))}
    </Desk.Attachments>
  );
}

function AttachmentCard({
  part,
  onOpenDocument
}: {
  part: MessagePart;
  onOpenDocument?: (material: MaterialSummaryDto) => void;
}) {
  const { t, locale } = useI18n();
  const material = useQuery(attachmentPreviewOptions(part.sourceId));
  const source = useQuery(attachmentSourceOptions(part.sourceId));
  const { icon: Icon, label, tone } = appearances[part.sourceKind];
  const meta = [
    t(label),
    source.data ? mediaSize(locale, Number(source.data.sizeBytes)) : undefined
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <Desk.AttachmentCard
        name={part.sourceName}
        meta={
          material.data
            ? meta
            : `${meta} · ${t(part.sourceId === null ? 'ReaderOriginalUnavailable' : material.error ? 'Retry' : 'SessionPending')}`
        }
        icon={<Icon size={22} aria-hidden="true" />}
        tone={tone}
        preview={
          ['image', 'video', 'audio'].includes(part.sourceKind) ? (
            <SourcePreview part={part} />
          ) : undefined
        }
        render={attachmentTarget({
          part,
          material: material.data,
          retry: () => void material.refetch(),
          failed: !!material.error,
          onOpenDocument
        })}
      />
      {material.error && (
        <SessionReadError error={material.error} retry={() => void material.refetch()} />
      )}
    </div>
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
  material,
  retry,
  failed,
  onOpenDocument
}: {
  part: MessagePart;
  material?: MaterialSummaryDto;
  retry: () => void;
  failed: boolean;
  onOpenDocument?: (material: MaterialSummaryDto) => void;
}) {
  if (!material)
    return <button type="button" aria-label={part.sourceName} disabled={!failed} onClick={retry} />;

  if (onOpenDocument && ['document', 'text', 'note'].includes(part.sourceKind))
    return (
      <button type="button" aria-label={part.sourceName} onClick={() => onOpenDocument(material)} />
    );

  return <Link to="/materials/$materialId" params={{ materialId: String(material.id) }} />;
}
