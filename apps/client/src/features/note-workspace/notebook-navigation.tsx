import type { NoteId } from '@study/contracts';
import { CollapseIcon } from '@study/icons';
import { NotebookRail } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { NoteSummary } from './note-editor';
import { jumpToNotebookTarget, notebookTargetId } from './notebook-index';
import type { notebookTimeline } from './notebook-index';
import { messageSectionTitle } from './section-title';

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
          <CollapseIcon size={12} />
        </NotebookRail.More>
      )}
      {entries.map((entry) => {
        if (entry.kind === 'page') {
          const target = notebookTargetId(id, 'page', entry.page.id);

          return (
            <NotebookRail.Marker
              key={target}
              target={target}
              kind="page"
              label={entry.page.title}
              preview={entry.page.title}
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

        const value = current?.text ?? '';
        const label = messageSectionTitle(message) ?? (
          <NoteSummary value={value} fallback={fallback} />
        );

        return (
          <NotebookRail.Marker
            key={target}
            target={target}
            kind={
              message.format === 'document'
                ? 'page'
                : message.role === 'assistant'
                  ? 'reply'
                  : 'note'
            }
            label={label}
            preview={value.slice(0, 320) || fallback}
            onSelect={() => jumpToNotebookTarget(target)}
          />
        );
      })}
    </NotebookRail.Root>
  );
}
