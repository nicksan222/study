import { Appearance, Language } from '@study/contracts';
import { catalogs, text } from '@study/localization';
import { test } from '@study/testing';

import { hideExtractionTime, materialFormats } from './fixtures/material-formats.ts';

const copy = catalogs.italian;

const desktop = { width: 1440, height: 900 };

const phone = { width: 390, height: 844 };

type Format = keyof typeof materialFormats;

const expectedStatus = {
  docx: 'complete',
  pptx: 'complete',
  xlsx: 'complete',
  pdf: 'waiting',
  md: 'complete',
  txt: 'complete',
  png: 'waiting',
  json: 'complete',
  csv: 'complete',
  zip: 'unsupported',
  bin: 'unsupported',
  mp3: 'unsupported',
  wav: 'unsupported',
  mp4: 'unsupported'
} satisfies Record<Format, 'complete' | 'waiting' | 'unsupported'>;

type CaptureContext = Pick<test.browser.Context, 'page' | 'expect'>;

function mediaReady(element: Element) {
  return (
    element instanceof HTMLMediaElement &&
    element.readyState >= HTMLMediaElement.HAVE_METADATA &&
    element.paused &&
    element.currentTime === 0
  );
}

async function openOriginal({ page, expect }: CaptureContext) {
  const original = page.getByRole('button', { name: copy.UploadedMaterialsOriginal, exact: true });

  await expect(original).toBeVisible();

  if ((await original.getAttribute('aria-pressed')) !== 'true') await original.click();

  await expect(original).toHaveAttribute('aria-pressed', 'true');
}

async function expectMedia(context: CaptureContext, format: 'png' | 'mp3' | 'wav' | 'mp4') {
  const { page, expect } = context;

  await openOriginal(context);

  if (format === 'png') {
    const image = page.getByRole('img', { name: materialFormats.png.name });

    await expect(image).toBeInViewport();
    await expect
      .poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);

    return;
  }

  const player = page.locator(format === 'mp4' ? 'video[controls]' : 'audio[controls]');

  await expect(player).toHaveAttribute('aria-label', materialFormats[format].name);
  await expect(player).toBeInViewport();
  await expect.poll(() => player.evaluate(mediaReady)).toBe(true);
}

function readiness(context: CaptureContext) {
  const { page, expect } = context;
  const reader = page.locator('[data-materials-reader]');
  const heading = (name: string) => reader.getByRole('heading', { name, exact: true });
  const content = (value: string) => reader.getByText(value, { exact: true });
  const details = reader.getByRole('region', { name: copy.MaterialFileInformation });

  return {
    docx: async () => {
      await expect(heading('Osservare la mitosi')).toBeInViewport();
      await expect(reader.getByRole('cell', { name: '12', exact: true })).toBeVisible();
    },
    pptx: async () => {
      await expect(content('I cromosomi si allineano al centro della cellula.')).toBeInViewport();
      await expect(content('I cromatidi fratelli si separano.')).toBeVisible();
    },
    xlsx: async () => {
      await expect(heading('Conteggio')).toBeInViewport();
      await expect(reader.getByRole('cell', { name: 'Profase', exact: true })).toBeInViewport();
      await expect(heading('Preparati')).toBeVisible();
    },
    pdf: async () => {
      await openOriginal(context);
      const viewer = reader.getByRole('region', { name: copy.PdfDocument });

      await expect(viewer.locator('canvas')).toBeInViewport();
      await expect(viewer.getByText('Prima della divisione', { exact: true })).toBeInViewport();
      await expect(
        reader.getByRole('status').filter({
          hasText: text('italian', 'PdfPagePosition', { page: 1, total: 3 })
        })
      ).toBeVisible();
    },
    md: async () => {
      await expect(heading('La divisione cellulare')).toBeInViewport();
      await expect(reader.locator('strong').filter({ hasText: 'metafase' })).toBeInViewport();
      await expect(reader.getByRole('table')).toBeVisible();
    },
    txt: () =>
      expect(
        reader.getByText(/Cell Biology — Organelles and protein trafficking/)
      ).toBeInViewport(),
    png: () => expectMedia(context, 'png'),
    json: async () => {
      await openOriginal(context);
      const original = reader.locator('pre');

      await expect(original).toContainText('"vetrino": "B-08"');
      await expect(original).toBeInViewport();
    },
    csv: async () => {
      const grid = reader.getByRole('grid');

      await expect(grid.getByRole('gridcell', { name: 'Metafase', exact: true })).toBeInViewport();
      await expect(grid.getByRole('gridcell', { name: '12', exact: true })).toBeInViewport();
    },
    zip: async () => {
      await expect(details.getByText('Archivio · ZIP', { exact: true })).toBeInViewport();
      await expect(
        reader.getByRole('button', { name: copy.ReaderOriginal, exact: true })
      ).toBeInViewport();
    },
    bin: async () => {
      await expect(details.getByText('File · BIN', { exact: true })).toBeInViewport();
      await expect(
        reader.getByRole('button', { name: copy.ReaderOriginal, exact: true })
      ).toBeInViewport();
    },
    mp3: () => expectMedia(context, 'mp3'),
    wav: () => expectMedia(context, 'wav'),
    mp4: () => expectMedia(context, 'mp4')
  } satisfies Record<Format, () => Promise<void>>;
}

test.browser.stable(
  'Material formats render on desktop and phone',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Biologia cellulare' })
    );
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));
    const formats = Object.keys(materialFormats) as Format[];
    const sources = new Map<Format, string>();

    for (const format of formats) {
      const { name, path } = materialFormats[format];
      const source = await rpc.runPromise(
        rpc.client['sources.createSource']({
          projectId: project.id,
          name,
          bytes: await Bun.file(path).bytes()
        })
      );

      sources.set(format, `/projects/${project.id}/sources/${source.id}?fromUploads=1`);
    }

    const reader = page.locator('[data-materials-reader]');
    const html = page.locator('html');
    const ready = readiness({ page, expect });

    const setup = async (viewport: typeof desktop, appearance: Appearance) => {
      await rpc.runPromise(
        rpc.client['settings.saveAppSettings']({
          ...settings,
          appearance,
          zoomPercent: viewport === phone ? 100 : settings.zoomPercent,
          language: Language.ITALIAN
        })
      );
      await page.setViewportSize(viewport);
      await page.goto(sources.get('docx')!);
    };

    const show = async (format: Format, viewport: typeof desktop, appearance: Appearance) => {
      await expect(html).toHaveAttribute('lang', 'it');
      await expect(html).toHaveJSProperty('scrollWidth', viewport.width);

      if (appearance === Appearance.DARK) await expect(html).toHaveClass(/\bdark\b/);
      else await expect(html).not.toHaveClass(/\bdark\b/);

      await ready[format]();
      await expect(reader.locator('[data-material-extraction-status]')).toHaveAttribute(
        'data-material-extraction-status',
        expectedStatus[format]
      );

      return reader.getByRole('heading', { name: materialFormats[format].name, exact: true });
    };

    const open = (format: Format) => page.goto(sources.get(format)!);

    const desktopShot = { target: 'viewport' } as const;
    const phoneShot = { target: 'viewport', zoomPercent: 100 } as const;
    const showDesktop = (format: Format) => show(format, desktop, Appearance.DARK);
    const showPhone = (format: Format) => show(format, phone, Appearance.LIGHT);

    await setup(desktop, Appearance.DARK);
    await expectScreenshot('docx-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('docx')).toBeInViewport()
    });
    await open('pptx');
    await expectScreenshot('pptx-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('pptx')).toBeInViewport()
    });
    await open('xlsx');
    await expectScreenshot('xlsx-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('xlsx')).toBeInViewport()
    });
    await open('pdf');
    await expectScreenshot('pdf-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('pdf')).toBeInViewport()
    });
    await open('md');
    await expectScreenshot('md-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('md')).toBeInViewport()
    });
    await open('txt');
    await expectScreenshot('txt-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('txt')).toBeInViewport()
    });
    await open('png');
    await expectScreenshot('png-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('png')).toBeInViewport()
    });
    await open('json');
    await expectScreenshot('json-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('json')).toBeInViewport()
    });
    await open('csv');
    await expectScreenshot('csv-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('csv')).toBeInViewport()
    });
    await open('zip');
    await expectScreenshot('zip-desktop-dark', {
      ...desktopShot,
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      ready: async () => expect(await showDesktop('zip')).toBeInViewport()
    });
    await open('bin');
    await expectScreenshot('bin-desktop-dark', {
      ...desktopShot,
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      ready: async () => expect(await showDesktop('bin')).toBeInViewport()
    });
    await open('mp3');
    await expectScreenshot('mp3-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('mp3')).toBeInViewport()
    });
    await open('wav');
    await expectScreenshot('wav-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('wav')).toBeInViewport()
    });
    await open('mp4');
    await expectScreenshot('mp4-desktop-dark', {
      ...desktopShot,
      ready: async () => expect(await showDesktop('mp4')).toBeInViewport()
    });

    await setup(phone, Appearance.LIGHT);
    await expectScreenshot('docx-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('docx')).toBeInViewport()
    });
    await open('pptx');
    await expectScreenshot('pptx-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('pptx')).toBeInViewport()
    });
    await open('xlsx');
    await expectScreenshot('xlsx-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('xlsx')).toBeInViewport()
    });
    await open('pdf');
    await expectScreenshot('pdf-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('pdf')).toBeInViewport()
    });
    await open('md');
    await expectScreenshot('md-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('md')).toBeInViewport()
    });
    await open('txt');
    await expectScreenshot('txt-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('txt')).toBeInViewport()
    });
    await open('png');
    await expectScreenshot('png-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('png')).toBeInViewport()
    });
    await open('json');
    await expectScreenshot('json-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('json')).toBeInViewport()
    });
    await open('csv');
    await expectScreenshot('csv-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('csv')).toBeInViewport()
    });
    await open('zip');
    await expectScreenshot('zip-phone-light', {
      ...phoneShot,
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      ready: async () => expect(await showPhone('zip')).toBeInViewport()
    });
    await open('bin');
    await expectScreenshot('bin-phone-light', {
      ...phoneShot,
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      ready: async () => expect(await showPhone('bin')).toBeInViewport()
    });
    await open('mp3');
    await expectScreenshot('mp3-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('mp3')).toBeInViewport()
    });
    await open('wav');
    await expectScreenshot('wav-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('wav')).toBeInViewport()
    });
    await open('mp4');
    await expectScreenshot('mp4-phone-light', {
      ...phoneShot,
      ready: async () => expect(await showPhone('mp4')).toBeInViewport()
    });
  }
);
