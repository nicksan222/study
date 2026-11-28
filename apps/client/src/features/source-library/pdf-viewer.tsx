import { MinimizeIcon, ZoomInIcon, ZoomOutIcon } from '@study/icons';
import { ErrorState, IconButton, Loading, SourceReader } from '@study/ui';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import { useLayoutEffect, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';

import { useI18n } from '#client/lib/i18n.tsx';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href;

const pdfAssets = `${import.meta.env.BASE_URL}pdf-assets/`;

const options = {
  cMapUrl: `${pdfAssets}cmaps/`,
  iccUrl: `${pdfAssets}iccs/`,
  standardFontDataUrl: `${pdfAssets}standard_fonts/`,
  wasmUrl: `${pdfAssets}wasm/`
};

const fit = 100;

const zoomStep = 25;

const minZoom = 50;

const maxZoom = 200;

export default function PdfViewer({ file }: { file: Blob }) {
  const { t } = useI18n();
  const [protectedFile, setProtectedFile] = useState<Blob>();

  if (protectedFile === file) return <ErrorState title={t('PdfPasswordRequired')} />;

  return (
    <SourceReader.Pdf>
      <Document
        file={file}
        options={options}
        suspense={false}
        loading={<Loading label={t('PdfLoading')} layout="panel" />}
        error={<ErrorState title={t('PdfOpenFailed')} />}
        onPassword={() => setProtectedFile(file)}
      >
        {({ pdf }) => <PdfPages total={pdf.numPages} />}
      </Document>
    </SourceReader.Pdf>
  );
}

function PdfPages({ total }: { total: number }) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(fit);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = viewport.current;

    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  function changePage(next: number) {
    if (next === page) return;

    setPage(next);
    viewport.current?.scrollTo(0, 0);
  }

  return (
    <>
      <PdfControls page={page} total={total} zoom={zoom} goTo={changePage} setZoom={setZoom} />
      <SourceReader.PdfViewport ref={viewport} aria-label={t('PdfDocument')}>
        {width > 0 && (
          <PdfPage key={page} page={page} width={Math.min(width, 960)} scale={zoom / fit} />
        )}
      </SourceReader.PdfViewport>
    </>
  );
}

function PdfPage({ page, width, scale }: { page: number; width: number; scale: number }) {
  const { t } = useI18n();
  const [failedSize, setFailedSize] = useState<{ width: number; scale: number }>();

  if (failedSize?.width === width && failedSize.scale === scale)
    return <ErrorState title={t('PdfPageFailed')} />;

  return (
    <Page
      pageNumber={page}
      width={width}
      scale={scale}
      devicePixelRatio={Math.min(window.devicePixelRatio, 2)}
      renderAnnotationLayer={false}
      loading={<Loading label={t('PdfPageLoading')} layout="panel" />}
      error={<ErrorState title={t('PdfPageFailed')} />}
      onRenderError={() => setFailedSize({ width, scale })}
    />
  );
}

function PdfControls({
  page,
  total,
  zoom,
  goTo,
  setZoom
}: {
  page: number;
  total: number;
  zoom: number;
  goTo: (page: number) => void;
  setZoom: (zoom: number) => void;
}) {
  const { t, number } = useI18n();

  return (
    <SourceReader.PdfControls>
      <SourceReader.PageStepper
        label={t('PdfPages')}
        previousLabel={t('PdfPreviousPage')}
        nextLabel={t('PdfNextPage')}
        position={t('PdfPagePosition', { page: number(page), total: number(total) })}
        page={page}
        total={total}
        onPageChange={goTo}
      />
      <div role="group" aria-label={t('PdfZoom')}>
        <IconButton
          size="icon-sm"
          label={t('PdfZoomOut')}
          aria-disabled={zoom === minZoom}
          onClick={() => setZoom(Math.max(minZoom, zoom - zoomStep))}
        >
          <ZoomOutIcon aria-hidden="true" />
        </IconButton>
        <output>{number(zoom / fit, { style: 'percent' })}</output>
        <IconButton
          size="icon-sm"
          label={t('PdfZoomIn')}
          aria-disabled={zoom === maxZoom}
          onClick={() => setZoom(Math.min(maxZoom, zoom + zoomStep))}
        >
          <ZoomInIcon aria-hidden="true" />
        </IconButton>
        <IconButton size="icon-sm" label={t('PdfFitWidth')} onClick={() => setZoom(fit)}>
          <MinimizeIcon aria-hidden="true" />
        </IconButton>
      </div>
    </SourceReader.PdfControls>
  );
}
