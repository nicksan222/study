import { Language } from '@study/contracts';
import { catalogs, text } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const name = 'river-survey.pdf';

const fixture = new URL('./fixtures/river-survey.pdf', import.meta.url);

async function importPdf(
  { page, rpc }: Pick<test.browser.Context, 'page' | 'rpc'>,
  filename: string,
  buffer: Buffer
) {
  const project = await rpc.runPromise(rpc.client['projects.createProject']({ name: 'Fieldwork' }));
  const source = await rpc.runPromise(
    rpc.client['sources.createSource']({ name: filename, bytes: buffer, projectId: project.id })
  );

  await page.goto(`/projects/${project.id}/sources/${source.id}?fromUploads=1`);
}

test.browser.stable(
  'Read a multipage PDF in Materials',
  async ({ page, expect, expectScreenshot, rpc }) => {
    const buffer = Buffer.from(await Bun.file(fixture).arrayBuffer());

    await importPdf({ page, rpc }, name, buffer);

    const panel = page.locator('[data-materials-reader]');
    const viewer = panel.getByRole('region', { name: copy.PdfDocument });
    const canvas = viewer.locator('canvas');
    const next = panel.getByRole('button', { name: copy.PdfNextPage });
    const previous = panel.getByRole('button', { name: copy.PdfPreviousPage });
    const zoomIn = panel.getByRole('button', { name: copy.PdfZoomIn });
    const zoomOut = panel.getByRole('button', { name: copy.PdfZoomOut });
    const fit = panel.getByRole('button', { name: copy.PdfFitWidth });

    await panel
      .getByRole('button', { name: copy.UploadedMaterialsOriginal, exact: true })
      .press('Enter');
    await expectScreenshot('pdf-page-one', {
      target: 'viewport',
      ready: async () => {
        await expect(canvas).toBeVisible();
        await expect(viewer.getByText('Field methods', { exact: true })).toBeInViewport();
      }
    });

    const fittedPage = await canvas.boundingBox();

    if (!fittedPage) throw new Error('PDF page has no layout box');

    await expect(previous).toBeDisabled();
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(next).toBeFocused();
    await expect(next).toBeDisabled();
    await expect(panel.getByRole('status').filter({ hasText: 'Page 2 of 2' })).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect(viewer.getByText('Reading the results', { exact: true })).toBeInViewport();

    await page.keyboard.press('Shift+Tab');
    await expect(previous).toBeFocused();
    await page.keyboard.press('Space');
    await expect(viewer.getByText('Field methods', { exact: true })).toBeInViewport();

    await zoomIn.press('Space');
    await expect(zoomIn).toBeFocused();
    await expect(panel.getByRole('status').filter({ hasText: '125%' })).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect
      .poll(async () =>
        Math.abs(((await canvas.boundingBox())?.width ?? 0) - fittedPage.width * 1.25)
      )
      .toBeLessThan(2);
    await zoomOut.press('Enter');
    await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(fittedPage.width);
    await zoomIn.press('Enter');
    await fit.press('Enter');
    await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(fittedPage.width);

    const footer = viewer.getByText('1', { exact: true });

    await expect(footer).not.toBeInViewport();
    await page.keyboard.press('Tab');
    await expect(viewer).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(footer).toBeInViewport();
    await previous.press('Enter');
    await expect(footer).toBeInViewport();

    await next.press('Enter');
    await zoomIn.press('Enter');
    await expect(viewer.getByText('Reading the results', { exact: true })).toBeInViewport();
    await expect(panel.getByRole('status').filter({ hasText: '125%' })).toBeVisible();

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({
        ...settings,
        language: Language.ITALIAN
      })
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(
      panel.getByRole('status').filter({
        hasText: text('italian', 'PdfPagePosition', { page: 2, total: 2 })
      })
    ).toBeVisible();
    await expect(panel.getByRole('status').filter({ hasText: '125%' })).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 860 });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await panel
      .getByRole('button', { name: catalogs.italian.UploadedMaterialsOriginal, exact: true })
      .click();
    const italianViewer = panel.getByRole('region', { name: catalogs.italian.PdfDocument });

    await expect(italianViewer.locator('canvas')).toBeInViewport();
    await expect(
      panel.getByRole('status').filter({
        hasText: text('italian', 'PdfPagePosition', { page: 1, total: 2 })
      })
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: catalogs.italian.PdfFitWidth })).toBeInViewport({
      ratio: 1
    });
  }
);

test.browser.stable(
  'Reports a PDF that cannot be opened',
  async ({ page, expect, expectScreenshot, rpc }) => {
    const filename = 'damaged.pdf';

    await importPdf({ page, rpc }, filename, Buffer.from('%PDF-1.7\nDamaged document'));

    const panel = page.locator('[data-materials-reader]');
    const item = page
      .getByRole('navigation', { name: copy.UploadedMaterials })
      .getByRole('link', { name: filename, exact: true });

    await panel.getByRole('button', { name: copy.UploadedMaterialsOriginal, exact: true }).click();

    await expectScreenshot('pdf-open-error', {
      target: 'viewport',
      ready: async () => {
        await expect(item.getByText(copy.UploadedMaterialsFailed, { exact: true })).toBeVisible();
        await expect(panel.getByRole('alert', { name: copy.PdfOpenFailed })).toBeVisible();
        await expect(panel.getByRole('button', { name: copy.ReaderOriginal })).toBeEnabled();
      }
    });
  }
);
