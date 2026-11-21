import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { hideExtractionTime } from './fixtures/material-formats.ts';

const copy = catalogs.english;

const middle = 'Lecture midpoint: compare the shaded bank with the exposed shore.';

const paragraphs = Array.from(
  { length: 24 },
  (_, index) =>
    `Field lecture ${index + 1}. The river team measures the marked post before collecting samples. Keep the time, location and original reading together so the next group can repeat the route. Compare the water level with the previous season and explain each correction using the retained evidence. ` +
    (index === 12 ? middle : 'Record the weather before moving to the next station.')
);

const sourceMiddle = 'Source midpoint: the eastern station records seven willow trees.';

const sourceLast = 'Source conclusion: the final tide reading completes the survey.';

const longSource = [
  '# Coastal evidence',
  'Source beginning: the lighthouse marks the first observation.',
  ...paragraphs.map(
    (text, index) =>
      `## Station ${index + 1}\n\n${text}${index === 12 ? `\n\n${sourceMiddle}` : ''}`
  ),
  sourceLast
].join('\n\n');

const localFiles = [
  { name: 'coastal-evidence.md', text: longSource, expected: 'Coastal evidence' },
  {
    name: 'water-level.txt',
    text: 'Water level sentinel: twelve centimetres.',
    expected: 'Water level sentinel: twelve centimetres.'
  },
  {
    name: 'duplicate.txt',
    text: 'North duplicate sentinel: count seven willows.',
    expected: 'North duplicate sentinel: count seven willows.'
  },
  {
    name: 'duplicate.txt',
    text: 'South duplicate sentinel: count nine poplars.',
    expected: 'South duplicate sentinel: count nine poplars.'
  },
  {
    name: 'summary.md',
    text: '# Survey summary\n\nSummary sentinel: retain the eastern route.',
    expected: 'Summary sentinel: retain the eastern route.'
  }
];

const fixtureDirectory = new URL(
  '../../../server/src/features/sources/decoders/fixtures/',
  import.meta.url
);

test.browser.stable(
  'Materials retain distinct originals when extraction is unavailable',
  async ({ page, expectScreenshot, expect, rpc }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Fieldwork' })
    );
    const originals = [
      ...localFiles.map((file) => ({
        name: file.name,
        bytes: new TextEncoder().encode(file.text)
      })),
      ...(await Promise.all(
        ['sample.pptx', 'interleaved.pptx', 'sample.docx', 'two-pages.pdf'].map(async (name) => ({
          name,
          bytes: await Bun.file(new URL(name, fixtureDirectory)).bytes()
        }))
      )),
      { name: 'unsupported.bin', bytes: new Uint8Array([0, 255, 1, 254, 2, 253]) }
    ];
    const sources = [];

    for (const { name, bytes } of originals)
      sources.push(
        await rpc.runPromise(
          rpc.client['sources.createSource']({ name, bytes, projectId: project.id })
        )
      );

    await page.goto(`/projects/${project.id}/uploads`);
    const library = page.getByRole('navigation', { name: copy.UploadedMaterials });
    const panel = page.locator('[data-materials-reader]');

    await expect(library.getByRole('link')).toHaveCount(originals.length);
    await expect(library.getByRole('link', { name: 'duplicate.txt', exact: true })).toHaveCount(2);

    const expectedContent = [
      ...localFiles.map(({ expected }) => expected),
      'Speaker notes',
      'Cell',
      'First paragraph'
    ];

    for (const [index, expected] of expectedContent.entries()) {
      const source = sources[index]!;
      const row = library.locator(`a[href*="/sources/${source.id}?"]`);

      await row.click();
      await expect(row).toHaveAttribute('aria-current', 'page');
      await expect(panel.getByText(expected, { exact: true })).toBeVisible();

      if (source.name === 'duplicate.txt')
        await expect(
          panel.getByText(localFiles[index === 2 ? 3 : 2]!.expected, { exact: true })
        ).toHaveCount(0);
    }

    await library.getByRole('link', { name: 'two-pages.pdf', exact: true }).click();
    await panel.getByRole('button', { name: copy.UploadedMaterialsOriginal, exact: true }).click();
    await expect(
      panel.getByRole('region', { name: copy.PdfDocument }).locator('canvas')
    ).toBeVisible();

    const originalOnly = library.getByRole('link', { name: 'unsupported.bin', exact: true });

    await originalOnly.click();
    await expectScreenshot('original-only', {
      target: 'viewport',
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      ready: async () => {
        await expect(
          originalOnly.getByText(copy.MaterialOriginalOnly, { exact: true })
        ).toBeVisible();
        await expect(
          panel.getByRole('button', { name: copy.ReaderOriginal, exact: true })
        ).toBeEnabled();
        await expect(library.getByRole('link')).toHaveCount(originals.length);
      }
    });

    const download = page.waitForEvent('download');

    await panel.getByRole('button', { name: copy.ReaderOriginal, exact: true }).click();
    expect(await Bun.file(await (await download).path()).bytes()).toEqual(originals.at(-1)!.bytes);

    await page.reload();
    await expect(library.getByRole('link')).toHaveCount(originals.length);
    await expect(originalOnly).toHaveAttribute('aria-current', 'page');

    const longFile = library.getByRole('link', { name: 'coastal-evidence.md', exact: true });

    await longFile.click();
    await expect(
      panel.getByRole('heading', { name: 'Coastal evidence', exact: true })
    ).toBeVisible();
    await expect(panel.getByText(sourceLast, { exact: true })).toBeVisible();
  }
);
