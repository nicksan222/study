import type { sessionGenerationSchema } from '@study/contracts/conversations/rpc';
import type { MaterialVersionId, SessionId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@study/ui/dialog';
import { Loading } from '@study/ui/loading';
import { WorkspaceChanges, WorkspaceCard } from '@study/ui/workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, ArrowUpRight, History, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { ExactDocument } from '../material-library';
import { changeVersions, sessionChanges } from './changes';
import type { ChangeMessage } from './changes';
import { NoteContent, NoteSummary } from './note-editor';
import {
  generationOptions,
  sessionGenerationsOptions,
  threadOptions
} from './session-workspace.queries';
import { SessionReadError } from './status';
import { attachmentPreviewOptions } from './workspace-context.queries';

type Preview =
  | { kind: 'message'; message: ChangeMessage }
  | { kind: 'attachment'; name: string; sourceId: SourceId | null }
  | { kind: 'document'; name: string; versionId: MaterialVersionId };

/** Shows session changes or a starter hint inside the shared context surface. */
export function WorkspaceContext({ id, children }: { id?: SessionId; children?: ReactNode }) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Root
      aria-label={t(id ? 'SessionContextPanel' : 'SessionChanges')}
      variant="changes"
    >
      <WorkspaceChanges.Heading>
        <History size={15} aria-hidden="true" />
        <h2>{t('SessionChanges')}</h2>
      </WorkspaceChanges.Heading>
      {id ? (
        <SessionChanges key={String(id)} id={id} />
      ) : (
        <WorkspaceChanges.Empty>{t('SessionChangesStart')}</WorkspaceChanges.Empty>
      )}
      {children}
    </WorkspaceCard.Root>
  );
}

/** Combines paginated messages and unique generation runs with typed preview selection. */
function SessionChanges({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const thread = useInfiniteQuery(threadOptions(id));
  const generations = useInfiniteQuery(sessionGenerationsOptions(id));
  const [preview, setPreview] = useState<Preview>();
  const messages = sessionChanges(id, thread.data?.pages.flatMap((page) => page.items) ?? []);
  const runs = [
    ...new Map(
      generations.data?.pages.flatMap((page) => page.items).map((run) => [run.requestId, run])
    ).values()
  ];

  return (
    <>
      <WorkspaceChanges.List>
        {[thread, generations].some((query) => query.isPending) && (
          <WorkspaceChanges.Empty>
            <Loading label={t('LoadingStudy')} />
          </WorkspaceChanges.Empty>
        )}
        {thread.error && (
          <SessionReadError error={thread.error} retry={() => void thread.refetch()} />
        )}
        {generations.error && (
          <SessionReadError error={generations.error} retry={() => void generations.refetch()} />
        )}
        {[thread, generations].every((query) => query.isSuccess) &&
          messages.length + runs.length === 0 && (
            <WorkspaceChanges.Empty>{t('SessionChangesEmpty')}</WorkspaceChanges.Empty>
          )}
        {messages.map((message) => (
          <MessageChange key={String(message.id)} message={message} onPreview={setPreview} />
        ))}
        {runs.map((run) => (
          <GenerationChange key={run.requestId} run={run} onPreview={setPreview} />
        ))}
      </WorkspaceChanges.List>
      {[thread, generations].some((query) => query.hasNextPage) && (
        <WorkspaceChanges.More>
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={[thread, generations].some((query) => query.isFetchingNextPage)}
            onClick={() => {
              if (thread.hasNextPage) void thread.fetchNextPage();

              if (generations.hasNextPage) void generations.fetchNextPage();
            }}
          >
            {t('SessionChangesMore')}
          </Button>
        </WorkspaceChanges.More>
      )}
      <ChangePreview preview={preview} onClose={() => setPreview(undefined)} />
    </>
  );
}

/** Presents the selected change in a dismissible preview dialog. */
function ChangePreview({
  preview,
  onClose
}: {
  preview: Preview | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open={!!preview}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WorkspaceChanges.Dialog closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle>
            {preview?.kind === 'message'
              ? t(preview.message.role === 'user' ? 'SessionNote' : 'SessionReply')
              : preview?.name}
          </DialogTitle>
          <DialogDescription>{t('SessionChangesPreview')}</DialogDescription>
        </DialogHeader>
        <WorkspaceChanges.Preview>
          <PreviewContent preview={preview} />
        </WorkspaceChanges.Preview>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
      </WorkspaceChanges.Dialog>
    </Dialog>
  );
}

/** Lists a message revision and its source attachments as separate preview targets. */
function MessageChange({
  message,
  onPreview
}: {
  message: ChangeMessage;
  onPreview: (preview: Preview) => void;
}) {
  const { t } = useI18n();
  const { current } = changeVersions(message);

  return (
    <WorkspaceCard.Group>
      {current &&
        (current.text.trim() || message.versions.length > 1 || current.status !== 'complete') && (
          <WorkspaceCard.Item onClick={() => onPreview({ kind: 'message', message })}>
            {message.role === 'user' ? (
              <FileText aria-hidden="true" />
            ) : (
              <MessageSquare aria-hidden="true" />
            )}
            <WorkspaceChanges.Label>
              <strong>{<NoteSummary value={current.text} fallback={t('SessionNote')} />}</strong>
              <small>
                {t(
                  message.versions.length > 1
                    ? 'SessionChangesRevised'
                    : message.role === 'user'
                      ? 'SessionNote'
                      : 'SessionReply'
                )}
                {current.status !== 'complete' ? ' · ' + t('SessionPending') : ''}
              </small>
            </WorkspaceChanges.Label>
            <ArrowUpRight aria-hidden="true" />
          </WorkspaceCard.Item>
        )}
      {message.parts.map((part) => (
        <WorkspaceCard.Item
          key={String(part.id)}
          onClick={() =>
            onPreview({
              kind: 'attachment',
              name: part.sourceName,
              sourceId: part.sourceId
            })
          }
        >
          <Paperclip aria-hidden="true" />
          <WorkspaceChanges.Label>
            <strong>{part.sourceName}</strong>
            <small>{t('SessionChangesAttachment')}</small>
          </WorkspaceChanges.Label>
          <ArrowUpRight aria-hidden="true" />
        </WorkspaceCard.Item>
      ))}
    </WorkspaceCard.Group>
  );
}

/** Shows the current message version alongside its predecessor when one exists. */
function MessagePreview({ message }: { message: ChangeMessage }) {
  const { t } = useI18n();
  const { current, previous } = changeVersions(message);

  return (
    <WorkspaceChanges.Versions>
      {previous && (
        <section>
          <h3>
            {t('SessionChangesBefore')}{' '}
            <span>
              {t('ReaderVersion')} {String(previous.number)}
            </span>
          </h3>
          <WorkspaceChanges.Text data-previous>
            <NoteContent value={previous.text} />
          </WorkspaceChanges.Text>
        </section>
      )}
      <section>
        <h3>
          {t(
            previous
              ? 'SessionChangesCurrent'
              : message.role === 'user'
                ? 'SessionNote'
                : 'SessionReply'
          )}{' '}
          {current && (
            <span>
              {t('ReaderVersion')} {String(current.number)}
            </span>
          )}
        </h3>
        <WorkspaceChanges.Text>
          {current?.text ? <NoteContent value={current.text} /> : t('SessionReadUnavailable')}
        </WorkspaceChanges.Text>
      </section>
      {current && current.status !== 'complete' && <p role="status">{t('SessionPending')}</p>}
    </WorkspaceChanges.Versions>
  );
}

/** Loads the source-pinned document version and exposes read recovery before previewing it. */
function AttachmentPreview({ sourceId }: { sourceId: SourceId | null }) {
  const { t } = useI18n();
  const state = useQuery(attachmentPreviewOptions(sourceId));

  if (sourceId === null) return <p>{t('SessionReadUnavailable')}</p>;

  if (state.error)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;

  return state.data ? (
    <ExactDocument id={state.data.version.id} />
  ) : (
    <Loading label={t('SessionChangesPreparing')} />
  );
}

/** Enables document previews only for available generation outputs with an exact version. */
function GenerationChange({
  run,
  onPreview
}: {
  run: typeof sessionGenerationSchema.Type;
  onPreview: (preview: Preview) => void;
}) {
  const { t } = useI18n();
  const state = useQuery({
    ...generationOptions(run.requestId),
    enabled: run.state === 'available'
  });
  const versionId = run.resultVersionId ?? run.proposedVersionId;
  const title = state.data?.title || t('SessionTransform');
  const status = generationStatus(run);

  return (
    <WorkspaceCard.Group>
      <WorkspaceCard.Item
        disabled={!versionId || run.state !== 'available'}
        onClick={() => {
          if (versionId) onPreview({ kind: 'document', name: title, versionId });
        }}
      >
        <FileText aria-hidden="true" />
        <WorkspaceChanges.Label>
          <strong>{title}</strong>
          <small>{t(status)}</small>
        </WorkspaceChanges.Label>
        {versionId && <ArrowUpRight aria-hidden="true" />}
      </WorkspaceCard.Item>
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
    </WorkspaceCard.Group>
  );
}

/** Prioritizes retirement, availability and cancellation before labeling a generation result. */
function generationStatus(run: typeof sessionGenerationSchema.Type) {
  if (run.state === 'retired') return 'SessionRunRetired';

  if (run.state === 'unavailable') return 'SessionContextUnavailable';

  if (run.cancelled) return 'SessionCancelledTransform';

  if (run.resultVersionId) return 'SessionChangesGenerated';

  if (run.proposedVersionId) return 'SessionRunProposal';

  return 'SessionRunAwaitingOutput';
}

/** Dispatches each typed preview to its message, source or exact-version reader. */
function PreviewContent({ preview }: { preview: Preview | undefined }) {
  if (!preview) return null;

  switch (preview.kind) {
    case 'message':
      return <MessagePreview message={preview.message} />;
    case 'document':
      return <ExactDocument id={preview.versionId} />;
    case 'attachment':
      return <AttachmentPreview sourceId={preview.sourceId} />;
  }
}
