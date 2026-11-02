import type {
  materialCitationSchema,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { Textarea } from '@study/ui/textarea';

import { useI18n } from '../../lib/i18n';
import { AnnotationControls } from './annotation-controls';
import { EvidenceTarget, TargetPicker } from './annotation-target';
import { useReaderEvidence } from './reader-evidence.queries';

type EvidenceController = ReturnType<typeof useReaderEvidence>;

type Citation = typeof materialCitationSchema.Type;

function citationPrecision(citation: Citation) {
  if (citation.evidence?.availability !== 'available') return 'ReaderUnavailable';

  return citation.evidence.precision === 'exact' ? 'DocumentExact' : 'DocumentApproximate';
}

function citationSupport(citation: Citation) {
  switch (citation.support?.state) {
    case 'assessed':
      return 'DocumentUserAssessed';
    case 'stale':
      return 'DocumentStale';
    case 'unavailable':
      return 'ReaderUnavailable';
    default:
      return 'DocumentUnassessed';
  }
}

function CitationDetails({ citation }: { citation: Citation }) {
  const { t } = useI18n();

  return (
    <blockquote key={String(citation.marker)}>
      <p>{citation.quote}</p>
      {citation.evidence && <EvidenceTarget reference={citation.evidence.reference} />}
      <p>
        {t('DocumentCitation')} {String(citation.marker)} · {t(citationPrecision(citation))}
      </p>
      <p>
        {t('DocumentSupport')} {t(citationSupport(citation))}
      </p>
      {citation.support && citation.support.state !== 'unassessed' && (
        <>
          <p>
            {t(
              citation.support.assessment.judgment === 'supports'
                ? 'DocumentSupports'
                : citation.support.assessment.judgment === 'contradicts'
                  ? 'DocumentContradicts'
                  : 'DocumentUncertain'
            )}
          </p>
          {citation.support.assessment.note && <p>{citation.support.assessment.note}</p>}
          <EvidenceTarget
            reference={{ kind: 'range', target: citation.support.assessment.claim }}
          />
          <EvidenceTarget
            reference={{ kind: 'range', target: citation.support.assessment.evidence }}
          />
        </>
      )}
    </blockquote>
  );
}

function EvidenceQueryStatus({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { open, citations, annotations, identity } = c;

  return (
    <>
      {open && (citations.isPending || annotations.isPending) && (
        <Loading label={t('LoadingStudy')} />
      )}
      {identity.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('ReaderUnavailable')}
              <Button onClick={() => void identity.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}
    </>
  );
}

function CitationResults({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { citations } = c;

  return (
    <>
      {citations.data?.pages
        .flatMap((page) => page.items)
        .map((citation) => (
          <CitationDetails key={String(citation.marker)} citation={citation} />
        ))}
      {citations.hasNextPage && (
        <Button
          disabled={citations.isFetchingNextPage}
          onClick={() => void citations.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
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
            <p>
              {annotation.evidence.availability === 'available'
                ? annotation.evidence.excerpt
                : t('ReaderUnavailable')}
            </p>
            <p>
              {t('ReaderVersion')} {String(annotation.target.range.versionId)} ·{' '}
              {t(
                annotation.evidence.availability === 'available' &&
                  annotation.evidence.precision === 'exact'
                  ? 'DocumentExact'
                  : 'ReaderUnavailable'
              )}
            </p>
          </li>
        ))}
      </ul>
      {annotations.hasNextPage && (
        <Button
          disabled={annotations.isFetchingNextPage}
          onClick={() => void annotations.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </>
  );
}

function EvidenceFailure({ c }: { c: EvidenceController }) {
  const { t } = useI18n();
  const { citations, annotations } = c;

  return (
    <>
      {(citations.isError || annotations.isError) && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('DocumentEvidenceFailed')}{' '}
              <Button
                onClick={() => {
                  void citations.refetch();
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
  version: MaterialVersionDetailDto;
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
            materialId={version.material_id}
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
                reference={{ kind: 'range', target: { materialId: version.material_id, range } }}
              />
            </>
          )}
          <label>
            {t('DocumentAnnotationNote')}
            <Textarea
              value={note}
              disabled={busy}
              maxLength={100000}
              onChange={(event) => change({ note: event.target.value })}
            />
          </label>
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
        <p role="status">
          {t(
            outcome.outcome === 'saved'
              ? 'DocumentAnnotationSaved'
              : outcome.outcome === 'conflict'
                ? 'DocumentAnnotationConflict'
                : 'ReaderUnavailable'
          )}
        </p>
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

export function EvidenceDetails({ version }: { version: MaterialVersionDetailDto }) {
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
