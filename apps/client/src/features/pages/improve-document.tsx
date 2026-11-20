import type { Page, PageVersion, ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, DialogFooter, StatusMessage } from '@study/ui';
import { useId, useState } from 'react';

import { AiActionButton } from '#client/lib/ai-action-button.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ProposalReview } from '../document-editing';
import { ContentReadError } from '../document-presentation';
import { PageActionDialog } from './page-action-dialog';

type DocumentImprovement = {
  page: Page;
  version: PageVersion;
  projectId?: ProjectId;
  disabled: boolean;
};

function useImprovement({ page, version, projectId }: DocumentImprovement) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const request = rpc.pages.improvement.useQuery({ pageId: page.id, projectId });
  const improve = rpc.pages.improve.useMutation();
  const cancel = rpc.pages.cancelTransform.useMutation();
  const review = rpc.pages.transform.useQuery(reviewId ? { requestId: reviewId } : undefined);
  const proposal = review.data ?? request.data;
  const ready = request.isSuccess && version.document.blocks.some((block) => block.text.trim());
  const requestId = reviewId ?? request.data?.id;
  const resultError = proposal?.errorKind ?? cancel.error ?? review.error;

  function close() {
    setReviewId(undefined);
    setOpen(false);
  }

  function finish() {
    setInstruction('');
    setKey(crypto.randomUUID());
    close();
  }

  async function submit() {
    try {
      const result = await improve.mutate({
        key,
        versionId: version.id,
        projectId,
        instruction: instruction.trim(),
        language: locale
      });

      setReviewId(result.id);
    } catch {
      // The mutation presents the error and retains the request key for retry.
    }
  }

  function dismiss() {
    if (requestId) void cancel.mutate({ requestId }).then(finish, () => undefined);
  }

  return {
    t,
    open,
    setOpen,
    request,
    improve,
    cancel,
    proposal,
    requestId,
    ready,
    resultError,
    instruction,
    setInstruction,
    setReviewId,
    close,
    submit,
    dismiss
  };
}

export function ImproveDocument(props: DocumentImprovement) {
  const { disabled } = props;
  const {
    t,
    open,
    setOpen,
    request,
    improve,
    cancel,
    proposal,
    requestId,
    ready,
    resultError,
    instruction,
    setInstruction,
    setReviewId,
    close,
    submit,
    dismiss
  } = useImprovement(props);

  return (
    <>
      {request.data ? (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setReviewId(request.data?.id);
            setOpen(true);
          }}
        >
          {t('PageProposal')}
        </Button>
      ) : (
        <AiActionButton
          tier="medium"
          label={t('DocumentImprove')}
          disabled={disabled || !ready}
          onClick={() => setOpen(true)}
        >
          {t('DocumentImprove')}
        </AiActionButton>
      )}
      {request.error && (
        <ContentReadError error={request.error} retry={() => void request.refetch()} />
      )}
      {open && (
        <PageActionDialog
          pending={improve.isPending || cancel.isPending}
          onClose={close}
          title={t(requestId ? 'PageProposal' : 'DocumentImprove')}
          description={t('DocumentImproveHelp')}
        >
          {requestId ? (
            <ImprovementResult
              requestId={requestId}
              resultReady={!!proposal?.resultVersionId}
              error={resultError}
              busy={cancel.isPending}
              disabled={disabled}
              dismiss={dismiss}
            />
          ) : (
            <ImprovementPrompt
              instruction={instruction}
              onChange={setInstruction}
              error={improve.error}
              busy={improve.isPending}
              disabled={disabled}
              submit={() => void submit()}
            />
          )}
        </PageActionDialog>
      )}
    </>
  );
}

function ImprovementPrompt({
  instruction,
  onChange,
  error,
  busy,
  disabled,
  submit
}: {
  instruction: string;
  onChange: (value: string) => void;
  error: unknown;
  busy: boolean;
  disabled: boolean;
  submit: () => void;
}) {
  const { t } = useI18n();
  const id = useId();

  return (
    <>
      <label htmlFor={id}>{t('DocumentImproveInstruction')}</label>
      <textarea
        id={id}
        value={instruction}
        maxLength={10000}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
      {error != null && <ContentReadError error={error} />}
      <DialogFooter>
        <Button disabled={disabled || busy} onClick={submit}>
          {t('DocumentImprove')}
        </Button>
      </DialogFooter>
    </>
  );
}

function ImprovementResult({
  requestId,
  resultReady,
  error,
  busy,
  disabled,
  dismiss
}: {
  requestId: string;
  resultReady: boolean;
  error: unknown;
  busy: boolean;
  disabled: boolean;
  dismiss: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {error != null && <ContentReadError error={error} />}
      {resultReady ? (
        <ProposalReview requestId={requestId} dismiss={dismiss} disabled={disabled || busy} />
      ) : (
        <>
          {error == null && <StatusMessage>{t('PracticeGenerationRunning')}</StatusMessage>}
          <Button variant="outline" disabled={busy} onClick={dismiss}>
            {t('Cancel')}
          </Button>
        </>
      )}
    </>
  );
}
