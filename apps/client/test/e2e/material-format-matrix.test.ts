import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { materialFormats } from './fixtures/material-formats.ts';

const copy = catalogs.english;

type Format = keyof typeof materialFormats;

const formats = Object.keys(materialFormats) as Format[];

// An Euler circuit follows every directed pairing with a single click per edge.
function transitionOrder() {
  const destinations = new Map(formats.map((from) => [from, formats.filter((to) => from !== to)]));
  const remaining: Format[] = ['docx'];
  const circuit: Format[] = [];

  while (remaining.length) {
    const current = remaining.at(-1)!;
    const next = destinations.get(current)!.pop();

    if (next) remaining.push(next);
    else circuit.push(remaining.pop()!);
  }

  return circuit.reverse();
}

function materialViews(reader: ReturnType<test.browser.Context['page']['locator']>) {
  const preview = reader.getByRole('region', { name: copy.MaterialPreview });
  const details = reader.getByRole('region', { name: copy.MaterialFileInformation });
  const pdf = reader.getByRole('region', { name: copy.PdfDocument });

  return {
    docx: reader.getByRole('heading', { name: 'Domanda di laboratorio', exact: true }),
    pptx: reader.getByText('I cromatidi fratelli si separano.', { exact: true }),
    xlsx: reader.getByRole('heading', { name: 'Conteggio', exact: true }),
    pdf: pdf.locator('canvas'),
    md: reader.getByRole('heading', { name: 'La divisione cellulare', exact: true }),
    txt: reader.getByText('Cell Biology — Organelles and protein trafficking', { exact: true }),
    png: reader.getByRole('img', { name: materialFormats.png.name, exact: true }),
    json: reader.locator('pre').getByText(/"vetrino": "B-08"/),
    csv: preview.getByRole('grid').getByRole('gridcell', { name: 'Vetrino A', exact: true }),
    zip: details.getByText('Archive · ZIP', { exact: true }),
    bin: details.getByText('File · BIN', { exact: true }),
    mp3: reader.locator(`audio[aria-label="${materialFormats.mp3.name}"]`),
    wav: reader.locator(`audio[aria-label="${materialFormats.wav.name}"]`),
    mp4: reader.locator(`video[aria-label="${materialFormats.mp4.name}"]`)
  };
}

const preferredView = {
  docx: copy.UploadedMaterialsText,
  pptx: copy.UploadedMaterialsText,
  xlsx: copy.UploadedMaterialsText,
  pdf: copy.UploadedMaterialsOriginal,
  md: copy.MaterialPreview,
  txt: copy.UploadedMaterialsText,
  png: copy.UploadedMaterialsOriginal,
  json: copy.UploadedMaterialsText,
  csv: copy.MaterialPreview,
  zip: undefined,
  bin: undefined,
  mp3: copy.UploadedMaterialsOriginal,
  wav: copy.UploadedMaterialsOriginal,
  mp4: copy.UploadedMaterialsOriginal
} satisfies Record<Format, string | undefined>;

test.browser.stable(
  'Switch among fourteen material formats in one subject',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const subject = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Cell biology laboratory' })
    );
    const sidebar = page.getByRole('navigation', { name: copy.UploadedMaterials });
    const reader = page.locator('[data-materials-reader]');
    const selection = sidebar.locator('a[aria-current="page"]');
    const views = materialViews(reader);
    const links = new Map(
      formats.map((format) => [
        format,
        sidebar.getByRole('link').filter({
          has: page.getByText(materialFormats[format].name, { exact: true })
        })
      ])
    );
    const pressed = reader.locator('button[aria-pressed="true"]');

    await page.goto(`/projects/${subject.id}/uploads`);
    const picker = page.locator('input[type="file"]');
    const upload = page.getByRole('button', { name: copy.UploadedMaterialsAdd, exact: true });

    await picker.setInputFiles(
      await Promise.all(
        Object.values(materialFormats).map(async ({ name, mimeType, path }) => ({
          name,
          mimeType,
          buffer: Buffer.from(await Bun.file(path).arrayBuffer())
        }))
      )
    );

    for (const format of formats) await expect(links.get(format)!).toBeVisible();

    await expect(upload).toBeEnabled();
    await expect(sidebar.getByRole('link')).toHaveCount(formats.length);

    const hrefs = new Map(
      await Promise.all(
        formats.map(
          async (format) => [format, await links.get(format)!.getAttribute('href')] as const
        )
      )
    );

    async function verify(format: Format) {
      const { name } = materialFormats[format];
      const preferred = preferredView[format];

      await Promise.all([
        expect(selection).toContainText([name]),
        expect(page).toHaveURL(new URL(hrefs.get(format)!, page.url()).href),
        expect(reader.getByRole('heading', { name, exact: true })).toBeVisible(),
        expect(views[format]).toBeVisible(),
        preferred ? expect(pressed).toHaveText(preferred) : expect(pressed).toHaveCount(0)
      ]);
      await expect(selection).toHaveCount(1);
    }

    const order = transitionOrder();
    const visited = new Set<Format>();

    for (const [index, format] of order.entries()) {
      const link = links.get(format)!;
      const before = order[index - 1];

      await link.click();
      await verify(format);

      if (before) await expect(views[before]).toHaveCount(0);

      if (!visited.has(format)) {
        visited.add(format);
        await link.click();
        await verify(format);

        // Leave alternate reader state behind to exercise default view selection on return.
        if (preferredView[format]) {
          await reader
            .getByRole('button', { name: copy.UploadedMaterialsDetails, exact: true })
            .click();
          await expect(pressed).toHaveText(copy.UploadedMaterialsDetails);
        }
      }
    }

    await page.reload();
    await verify(order.at(-1)!);
    await expectScreenshot('mixed-subject', {
      target: 'viewport',
      ready: async () => {
        await expect(sidebar.getByRole('link')).toHaveCount(formats.length);
        await expect(sidebar.getByText(copy.NotePending, { exact: true })).toHaveCount(0);

        for (const format of ['pdf', 'png'] as const)
          await expect(
            links.get(format)!.getByText(copy.UploadedMaterialsWaiting, { exact: true })
          ).toBeVisible();

        await expect(views.docx).toBeVisible();
      }
    });

    for (const format of formats) {
      await links.get(format)!.click();
      await verify(format);
    }

    await page.setViewportSize({ width: 1120, height: 454 });
    const lastMaterial = sidebar.getByRole('link').last();
    const deepLink = await lastMaterial.getAttribute('href');

    await page.goto(new URL(deepLink!, page.url()).href);
    await expect(lastMaterial).toHaveAttribute('aria-current', 'page');
    await expect(lastMaterial).toBeInViewport({ ratio: 0.95 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: copy.UploadedMaterialsBack }).click();
    await expectScreenshot('mobile-material-list', {
      target: 'viewport',
      ready: () => expect(lastMaterial).toBeInViewport({ ratio: 0.95 })
    });
  }
);
