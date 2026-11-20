import type { SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { ErrorState, Loading, RetryButton } from '@study/ui';
import { Schema } from 'effect';
import { lazy, Suspense, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

const PdfViewer = lazy(() => import('./pdf-viewer'));

const encodeDigest = Schema.encodeSync(Schema.Uint8ArrayFromHex);

export function SourcePdfPreview({ sourceId }: { sourceId: SourceId }) {
  const { t } = useI18n();
  const original = rpc.sources.sourceExport.useQuery({ id: sourceId });
  const [loaded, setLoaded] = useState<{ digest: string; file: Blob }>();
  const loading = <Loading label={t('PdfLoading')} layout="panel" />;

  if (original.isError)
    return (
      <ErrorState
        title={t(
          toStudyError(original.error).kind === 'not_found' ? 'PdfMissing' : 'PdfFileReadFailed'
        )}
        action={<RetryButton label={t('Retry')} onClick={() => void original.refetch()} />}
      />
    );

  if (!original.data) return loading;

  // Live reads can deliver fresh byte arrays for the same original.
  const digest = encodeDigest(original.data.source.sha256);

  if (loaded?.digest !== digest) {
    const file = new Blob([new Uint8Array(original.data.bytes)], { type: 'application/pdf' });

    setLoaded({ digest, file });

    return loading;
  }

  return (
    <Suspense fallback={loading}>
      <PdfViewer file={loaded.file} />
    </Suspense>
  );
}
