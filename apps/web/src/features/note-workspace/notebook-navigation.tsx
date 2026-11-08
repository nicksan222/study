import type { NoteId } from '@study/contracts/ids';
import { NotebookRail } from '@study/ui/notebook-rail';
import { ChevronUp } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { NoteSummary } from './note-editor';
import { jumpToNotebookTarget, notebookTargetId } from './notebook-index';
import type { notebookTimeline } from './notebook-index';

export function NotebookNavigation({
  id,
  entries,
  more,
  pending,
  onMore
}: {
  id: NoteId;
  entries: ReturnType<typeof notebookTimeline>;
  more: boolean;
  pending: boolean;
  onMore: () => void;
}) {
  const { t } = useI18n();

  return (
    <NotebookRail.Root label={t('NotePageIndex')}>
      {more && (
        <NotebookRail.More
          type="button"
          aria-label={t('NoteEarlier')}
          disabled={pending}
          onClick={onMore}
        >
          <ChevronUp size={12} />
        </NotebookRail.More>
      )}
      {entries.map((entry) => {
        if (entry.kind === 'page') {
          const target = notebookTargetId(id, 'page', entry.document.id);

          return (
            <NotebookRail.Marker
              key={target}
              target={target}
              kind="page"
              label={entry.document.title}
              preview={entry.document.title}
              onSelect={() => jumpToNotebookTarget(target)}
            />
          );
        }

        const message = entry.message;
        const current = message.versions.find((version) => version.id === message.activeVersionId);
        const target = notebookTargetId(id, 'message', message.id);
        const fallback = t(
          message.format === 'document'
            ? 'NoteNewPage'
            : message.role === 'assistant'
              ? 'NoteReply'
              : 'NoteNote'
        );

        return (
          <MessageMarkers
            key={target}
            id={id}
            message={message}
            target={target}
            text={current?.text ?? ''}
            fallback={fallback}
          />
        );
      })}
    </NotebookRail.Root>
  );
}

function MessageMarkers({
  id,
  message,
  target,
  text,
  fallback
}: {
  id: NoteId;
  message: Extract<ReturnType<typeof notebookTimeline>[number], { kind: 'message' }>['message'];
  target: string;
  text: string;
  fallback: string;
}) {
  return (
    <>
      <NotebookRail.Marker
        target={target}
        kind={
          message.format === 'document' ? 'page' : message.role === 'assistant' ? 'reply' : 'note'
        }
        label={<NoteSummary value={text} fallback={fallback} />}
        preview={text.slice(0, 320) || fallback}
        onSelect={() => jumpToNotebookTarget(target)}
      />
      {message.format !== 'document' &&
        message.parts.map((part) => {
          const attachment = notebookTargetId(id, 'attachment', part.id);

          return (
            <NotebookRail.Marker
              key={attachment}
              target={attachment}
              kind="attachment"
              label={part.sourceName}
              preview={part.sourceName}
              onSelect={() => jumpToNotebookTarget(attachment)}
            />
          );
        })}
    </>
  );
}
