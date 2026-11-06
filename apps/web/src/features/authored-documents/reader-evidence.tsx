import type { assessmentViewSchema } from '@study/contracts/documents/evidence';
import type { citationSchema } from '@study/contracts/documents/schemas';
import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Field } from '@study/ui/field';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { StatusMessage } from '@study/ui/status-message';
import { Textarea } from '@study/ui/textarea';

import { useI18n } from '#web/lib/i18n.tsx';

import { CapturedInputLink } from '../source-library';
import { AnnotationControls } from './annotation-controls';
import { EvidenceTarget, TargetPicker } from './annotation-target';
import { useReaderEvidence } from './reader-evidence.queries';

type EvidenceController = ReturnType<typeof useReaderEvidence>;

type Citation = typeof citationSchema.Type;

function assessmentLabel(assessment: typeof assessmentViewSchema.Type | undefined) {
  if (!assessment) return 'DocumentUnassessed' as const;

  switch (assessment.state) {
    case 'assessed':
      return 'DocumentUserAssessed' as const;
    case 'stale':
      return 'DocumentStale' as const;
    default:
      return 'ReaderUnavailable' as const;
  }
}

const judgmentLabels = {
  supports: 'DocumentSupports',
  contradicts: 'DocumentContradicts',
  uncertain: 'DocumentUncertain'
} as const;

function CitationDetails({
  citation,
  assessment
}: {
  citation: Citation;
  assessment?: typeof assessmentViewSchema.Type;
}) {
  const { t } = useI18n();
  const input = citation.input;

  return (
    <blockquote>
      <p>{citation.quote}</p>
      <p>
        {t('DocumentCitation')} {citation.marker} ·{' '}
        {t(citation.target ? 'DocumentExact' : 'DocumentApproximate')}
      </p>
      {input.kind === 'document' && (
        <CapturedInputLink input={input} name={t('AnnotationOpenTarget')} />
      )}
      {input.kind === 'source' && input.snapshotId !== null && (
        <CapturedInputLink
          input={{ ...input, snapshotId: input.snapshotId }}
          name={t('AnnotationOpenTarget')}
        />
      )}
      {input.kind === 'message' && (
        <p>
          {t('ReaderVersion')} {String(input.versionId)}
        </p>
      )}
      <p>
        {t('DocumentSupport')} {t(assessmentLabel(assessment))}
      </p>
      {assessment && (
        <>
          <p>{t(judgmentLabels[assessment.assessment.judgment])}</p>
          <p>{assessment.assessment.note}</p>
          <EvidenceTarget reference={{ kind: 'range', target: assessment.assessment.claim }} />
        </>
      )}
    </blockquote>
  );
}

function EvidenceQueryStatus({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { open, citations, annotations } = c;

  return (
    <>
      {open && (citations.isPending || annotations.isPending) && (
        <Loading label={t('LoadingStudy')} />
      )}
    </>
  );
}

function CitationResults({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { citations, assessments } = c;
  const records = assessments.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      {citations.data?.citations.map((citation) => (
        <CitationDetails
          key={citation.marker}
          citation={citation}
          assessment={records.find((record) => record.assessment.marker === citation.marker)}
        />
      ))}
      {assessments.hasNextPage && (
        <LoadMoreButton
          disabled={assessments.isFetchingNextPage}
          onClick={() => void assessments.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </>
  );
}

function AnnotationResults({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { annotations } = c;

  return (
    <>
      <ul>
        {c.allAnnotations.map((annotation) => (
          <li key={String(annotation.id)}>
            <p>{annotation.note}</p>
            <AnnotationControls annotation={annotation} />
            <EvidenceTarget reference={{ kind: 'range', target: annotation.target }} />
          </li>
        ))}
      </ul>
      {annotations.hasNextPage && (
        <LoadMoreButton
          disabled={annotations.isFetchingNextPage}
          onClick={() => void annotations.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </>
  );
}

function EvidenceFailure({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { citations, annotations, assessments } = c;

  return (
    <>
      {(citations.isError || annotations.isError || assessments.isError) && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('DocumentEvidenceFailed')}{' '}
              <Button
                onClick={() => {
                  void citations.refetch();
                  void assessments.refetch();
                  void annotations.refetch();
                }}
              >
                {t('LibraryRefresh')}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

function AnnotationCreation({
  c,
  version
}: {
  c: EvidenceController;
  version: StudyDocumentVersion;
}) {
  const { t } = useI18n();
  const { open, range, change, note, busy, unresolved } = c;

  return (
    <>
      {open && (
        <>
          <h3>{t('DocumentAnnotate')}</h3>
          <p>{t('DocumentSelectPassage')}</p>
          <TargetPicker
            documentId={version.documentId}
            initialVersion={version.id}
            onPick={(target) => {
              change({ range: target?.range });
            }}
          />
          {range && (
            <>
              <p>{t('AnnotationPreview')}</p>
              <EvidenceTarget
                preview
                reference={{ kind: 'range', target: { documentId: version.documentId, range } }}
              />
            </>
          )}
          <Field label={<> {t('DocumentAnnotationNote')} </>}>
            <Textarea
              value={note}
              disabled={busy}
              maxLength={100000}
              onChange={(event) => change({ note: event.target.value })}
            />
          </Field>
          <Button disabled={busy || Boolean(unresolved) || !range} onClick={c.saveAnnotation}>
            {t('DocumentSaveAnnotation')}
          </Button>
        </>
      )}
    </>
  );
}

function AnnotationOutcome({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { outcome } = c;

  return (
    <>
      {outcome && (
        <StatusMessage>
          {t(
            outcome.outcome === 'saved'
              ? 'DocumentAnnotationSaved'
              : outcome.outcome === 'conflict'
                ? 'DocumentAnnotationConflict'
                : 'ReaderUnavailable'
          )}
        </StatusMessage>
      )}
    </>
  );
}

function AnnotationRecovery({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { unresolved, possibleMatches, busy, annotations, reviewed } = c;

  return (
    <>
      {unresolved && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              <p>{t('DocumentAnnotationUncertain')}</p>
              <p>{t('AnnotationSubmittedCreate')}</p>
              <p>{unresolved.note}</p>
              <p>{t(unresolved.kind === 'note' ? 'AnnotationNote' : 'AnnotationHighlight')}</p>
              <EvidenceTarget preview reference={{ kind: 'range', target: unresolved.target }} />
              <p>{t('AnnotationPossibleMatches')}</p>
              <ul>
                {possibleMatches.map((item) => (
                  <li key={String(item.id)}>
                    {String(item.id)} · {item.note}
                  </li>
                ))}
              </ul>
              <Button disabled={busy || annotations.isFetching} onClick={c.refreshCreation}>
                {t('LibraryRefresh')}
              </Button>
              <Button
                disabled={
                  busy ||
                  !reviewed ||
                  annotations.isFetching ||
                  annotations.isError ||
                  annotations.hasNextPage
                }
                onClick={c.acknowledgeCreation}
              >
                {t('AnnotationCreationReviewed')}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

export function EvidenceDetails({ version }: { version: StudyDocumentVersion }) {
  const { t } = useI18n();
  const c = useReaderEvidence(version);

  return (
    <MaterialLibrary.History
      open={c.open}
      onToggle={(event) => c.setOpen(event.currentTarget.open)}
    >
      <summary>{t('DocumentEvidence')}</summary>
      <p>{t('DocumentEvidenceExplanation')}</p>
      <EvidenceQueryStatus c={c} />
      <CitationResults c={c} />
      <AnnotationResults c={c} />
      <EvidenceFailure c={c} />
      <AnnotationCreation c={c} version={version} />
      <AnnotationOutcome c={c} />
      <AnnotationRecovery c={c} />
    </MaterialLibrary.History>
  );
}
