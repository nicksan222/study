import type { sessionGenerationSchema } from '@study/contracts/conversations/rpc';
import type { MaterialVersionId, SessionId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@study/ui/dialog';
import { WorkspaceCard } from '@study/ui/workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, ArrowUpRight, History, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { ExactDocument } from '../material-library/exact-document';
import { changeVersions, sessionChanges } from './changes';
import type { ChangeMessage } from './changes';
import {
  generationOptions,
  sessionGenerationsOptions,
  threadOptions
} from './session-workspace.queries';
import { SessionReadError } from './status';

import './changes.css';
type Preview =
  | { kind: 'message'; message: ChangeMessage }
  | { kind: 'attachment'; name: string; sourceId: SourceId | null }
  | { kind: 'document'; name: string; versionId: MaterialVersionId };
export function WorkspaceContext({ id, children }: { id?: SessionId; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <WorkspaceCard.Root
      aria-label={t(id ? 'SessionContextPanel' : 'SessionChanges')}
      className="session-changes"
    >
      <header className="session-changes-heading">
        <History size={15} aria-hidden="true" />
        <h2>{t('SessionChanges')}</h2>
      </header>
      {id ? (
        <SessionChanges key={String(id)} id={id} />
      ) : (
        <p className="session-changes-empty">{t('SessionChangesStart')}</p>
      )}
      {children}
    </WorkspaceCard.Root>
  );
}
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
      <div className="session-changes-list">
        {[thread, generations].some((query) => query.isPending) && (
          <p role="status" className="session-changes-empty">
            {t('LoadingStudy')}
          </p>
        )}
        {thread.error && (
          <SessionReadError error={thread.error} retry={() => void thread.refetch()} />
        )}
        {generations.error && (
          <SessionReadError error={generations.error} retry={() => void generations.refetch()} />
        )}
        {[thread, generations].every((query) => query.isSuccess) &&
          messages.length + runs.length === 0 && (
            <p className="session-changes-empty">{t('SessionChangesEmpty')}</p>
          )}
        {messages.map((message) => (
          <MessageChange key={String(message.id)} message={message} onPreview={setPreview} />
        ))}
        {runs.map((run) => (
          <GenerationChange key={run.requestId} run={run} onPreview={setPreview} />
        ))}
      </div>
      {[thread, generations].some((query) => query.hasNextPage) && (
        <div className="session-changes-more">
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
        </div>
      )}
      <ChangePreview preview={preview} onClose={() => setPreview(undefined)} />
    </>
  );
}

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
      <DialogPopup
        closeLabel={t('Close')}
        className="session-change-dialog"
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>
            {preview?.kind === 'message'
              ? t(preview.message.role === 'user' ? 'SessionNote' : 'SessionReply')
              : preview?.name}
          </DialogTitle>
          <DialogDescription>{t('SessionChangesPreview')}</DialogDescription>
        </DialogHeader>
        <div className="session-change-preview">
          <PreviewContent preview={preview} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

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
            <span className="session-change-label">
              <strong>{current.text.trim().split('\n')[0] || t('SessionNote')}</strong>
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
            </span>
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
          <span className="session-change-label">
            <strong>{part.sourceName}</strong>
            <small>{t('SessionChangesAttachment')}</small>
          </span>
          <ArrowUpRight aria-hidden="true" />
        </WorkspaceCard.Item>
      ))}
    </WorkspaceCard.Group>
  );
}

function MessagePreview({ message }: { message: ChangeMessage }) {
  const { t } = useI18n();
  const { current, previous } = changeVersions(message);
  return (
    <div className="session-change-versions">
      {previous && (
        <section>
          <h3>
            {t('SessionChangesBefore')}{' '}
            <span>
              {t('ReaderVersion')} {String(previous.number)}
            </span>
          </h3>
          <div className="session-change-text" data-previous>
            {previous.text}
          </div>
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
        <div className="session-change-text">{current?.text || t('SessionReadUnavailable')}</div>
      </section>
      {current && current.status !== 'complete' && <p role="status">{t('SessionPending')}</p>}
    </div>
  );
}
function AttachmentPreview({ sourceId }: { sourceId: SourceId | null }) {
  const { t } = useI18n();
  const state = useQuery({
    queryKey: ['materials', 'imported', String(sourceId)],
    enabled: sourceId !== null,
    queryFn: ({ signal }) =>
      request((client) => client['materials.importedMaterial']({ sourceId: sourceId! }), signal),
    refetchInterval: (query) => (query.state.data ? false : 3000)
  });
  if (sourceId === null) return <p>{t('SessionReadUnavailable')}</p>;
  if (state.error)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;
  return state.data ? (
    <ExactDocument id={state.data.version.id} />
  ) : (
    <p role="status">{t('SessionChangesPreparing')}</p>
  );
}
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
        <span className="session-change-label">
          <strong>{title}</strong>
          <small>{t(status)}</small>
        </span>
        {versionId && <ArrowUpRight aria-hidden="true" />}
      </WorkspaceCard.Item>
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
    </WorkspaceCard.Group>
  );
}

function generationStatus(run: typeof sessionGenerationSchema.Type) {
  if (run.state === 'retired') return 'SessionRunRetired';
  if (run.state === 'unavailable') return 'SessionContextUnavailable';
  if (run.cancelled) return 'SessionCancelledTransform';
  if (run.resultVersionId) return 'SessionChangesGenerated';
  if (run.proposedVersionId) return 'SessionRunProposal';
  return 'SessionRunAwaitingOutput';
}

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
