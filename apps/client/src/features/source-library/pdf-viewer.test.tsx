import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { ComponentProps, ReactNode } from 'react';
import type { Page } from 'react-pdf';

test.unit.stable(
  'retries a failed PDF page when the available width changes',
  async ({ act, expect, mock, render, screen, vi }) => {
    let resize!: (width: number) => void;
    let failRender: ComponentProps<typeof Page>['onRenderError'];

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(onResize: (entries: { contentRect: { width: number } }[]) => void) {
          resize = (width) => onResize([{ contentRect: { width } }]);
        }

        observe() {}

        disconnect() {}
      }
    );
    mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));
    mock('react-pdf', () => ({
      Document: ({ children }: { children: (state: { pdf: { numPages: number } }) => ReactNode }) =>
        children({ pdf: { numPages: 1 } }),
      Page: ({ width, onRenderError }: ComponentProps<typeof Page>) => {
        failRender = onRenderError;

        return <output>{width}</output>;
      }
    }));
    const { default: PdfViewer } = await import('./pdf-viewer');

    try {
      render(<PdfViewer file={new Blob()} />);
      act(() => resize(800));
      expect(screen.getByText('800', { exact: true })).toBeVisible();
      act(() => failRender?.(new Error('Canvas too large')));
      expect(screen.getByRole('alert', { name: catalogs.english.PdfPageFailed })).toBeVisible();
      act(() => resize(500));
      expect(screen.getByText('500', { exact: true })).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  }
);
