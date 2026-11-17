import { exactInputSchema } from '@study/contracts';
import type {
  assessmentViewSchema,
  pageCitationSchema as citationSchema,
  PageVersion
} from '@study/contracts';
import {
  LoadMoreButton,
  Button,
  ErrorState,
  Loading,
  MaterialLibrary,
  StatusMessage
} from '@study/ui';
import { Schema } from 'effect';

import { DictationTextarea } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { CapturedInputLink } from '../source-library';
import { AnnotationControls } from './annotation-controls';
import { EvidenceTarget, TargetPicker } from './annotation-target';
import { useReaderEvidence } from './reader-evidence.queries';

type EvidenceController = ReturnType<typeof useReaderEvidence>;

type Citation = typeof citationSchema.Type;

function assessmentLabel(assessment: typeof assessmentViewSchema.Type | undefined) {
  if (!assessment) return 'PageUnassessed' as const;

  switch (assessment.state) {
    case 'assessed':
      return 'PageUserAssessed' as const;
    case 'stale':
      return 'PageStale' as const;
    default:
      return 'ReaderUnavailable' as const;
  }
}

const judgmentLabels = {
  supports: 'PageSupports',
  contradicts: 'PageContradicts',
  uncertain: 'PageUncertain'
} as const;

function CitationDetails({
  citation,
  unavailable,
  assessment
}: {
  citation: Citation;
  unavailable: boolean;
  assessment?: typeof assessmentViewSchema.Type;
}) {
  const { t } = useI18n();
  const input = citation.input;

  return (
    <blockquote>
      <p>{citation.quote}</p>
      <p>
        {t('PageCitation')} {citation.marker} ·{' '}
        {t(citation.target ? 'PageExact' : 'PageApproximate')}
      </p>
      {unavailable && <p>{t('ReaderUnavailable')}</p>}
      {input.kind === 'page' && (
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
        {t('PageSupport')} {t(assessmentLabel(assessment))}
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
  const records = assessments.data?.items ?? [];

  return (
    <>
      {!!citations.data?.unavailableInputs.length && (
        <StatusMessage>{t('PageEvidenceUnavailable')}</StatusMessage>
      )}
      {citations.data?.citations.map((citation) => (
        <CitationDetails
          key={citation.marker}
          citation={citation}
          unavailable={citations.data!.unavailableInputs.some((input) =>
            Schema.toEquivalence(exactInputSchema)(input, citation.input)
          )}
          assessment={records.find((record) => record.assessment.marker === citation.marker)}
        />
      ))}

      {c.assessmentWindow.hasPrevious && (
        <Button variant="ghost" onClick={c.assessmentWindow.previous}>
          {t('LibraryPrevious')}
        </Button>
      )}
      {assessments.data?.nextCursor && (
        <LoadMoreButton
          disabled={assessments.isFetching}
          onClick={() => c.loadMoreAssessments()}
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

      {c.annotationWindow.hasPrevious && (
        <Button variant="ghost" onClick={c.annotationWindow.previous}>
          {t('LibraryPrevious')}
        </Button>
      )}
      {!!annotations.data?.nextCursor && (
        <LoadMoreButton
          disabled={annotations.isFetching}
          onClick={() => c.loadMoreAnnotations()}
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
              {t('PageEvidenceFailed')}{' '}
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

function AnnotationCreation({ c, version }: { c: EvidenceController; version: PageVersion }) {
  const { t } = useI18n();
  const { open, range, change, note, busy, unresolved } = c;

  return (
    <>
      {open && (
        <>
          <h3>{t('PageAnnotate')}</h3>
          <p>{t('PageSelectPassage')}</p>
          <TargetPicker
            pageId={version.pageId}
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
                reference={{ kind: 'range', target: { pageId: version.pageId, range } }}
              />
            </>
          )}
          <DictationTextarea
            label={t('PageAnnotationNote')}
            targetKey={`${version.pageId}:${version.id}`}
            value={note}
            disabled={busy}
            maxLength={100000}
            onValueChange={(note) => change({ note })}
          />
          <Button disabled={busy || Boolean(unresolved) || !range} onClick={c.saveAnnotation}>
            {t('PageSaveAnnotation')}
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
              ? 'PageAnnotationSaved'
              : outcome.outcome === 'conflict'
                ? 'PageAnnotationConflict'
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
              <p>{t('PageAnnotationUncertain')}</p>
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
                  !!annotations.data?.nextCursor
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

export function EvidenceDetails({ version }: { version: PageVersion }) {
  const { t } = useI18n();
  const c = useReaderEvidence(version);

  return (
    <MaterialLibrary.History
      open={c.open}
      onToggle={(event) => c.setOpen(event.currentTarget.open)}
    >
      <summary>{t('PageEvidence')}</summary>
      <p>{t('PageEvidenceExplanation')}</p>
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
