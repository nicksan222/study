import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

const middle = 'Lecture midpoint: compare the shaded bank with the exposed shore.';

const last = 'Lecture conclusion: preserve every original observation.';

const correctedLast = `${last} Final count verified.`;

const paragraphs = Array.from(
  { length: 24 },
  (_, index) =>
    `Field lecture ${index + 1}. The river team measures the marked post before collecting samples. Keep the time, location and original reading together so the next group can repeat the route. Compare the water level with the previous season and explain each correction using the retained evidence. ` +
    (index === 12 ? middle : 'Record the weather before moving to the next station.')
);

const original = ['Mixed attachment field lecture', ...paragraphs, last].join('\n\n');

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

testE2e(
  'Mixed lecture retains ten attachments through extraction failures',
  async ({ page, expectScreenshot }) => {
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });

    const notebook = page.getByRole('region', { name: copy.NoteNotebook });

    const entry = notebook.locator('[data-role="user"]');

    const body = entry.locator('.chat-message-text');

    const panel = page.getByRole('tabpanel');

    const preview = panel.getByRole('document', { name: copy.NotePageEditor });

    const noteLinks = page.locator('a[href^="/notes/"]');

    const names = [
      ...localFiles.map((file) => file.name),
      'sample.pptx',
      'interleaved.pptx',
      'sample.docx',
      'two-pages.pdf',
      'unsupported.bin'
    ];

    async function identities() {
      await expect(entry).toHaveCount(1);
      await expect(
        entry.getByRole('button').filter({ hasText: /\.md|\.txt|\.pptx|\.docx|\.pdf|\.bin/ })
      ).toHaveCount(10);

      for (const name of new Set(names))
        await expect(entry.getByRole('button', { name, exact: true })).toHaveCount(
          name === 'duplicate.txt' ? 2 : 1
        );
    }

    async function controls() {
      for (const label of [copy.NoteClosePage, copy.NoteExpandEditor]) {
        const control = page.getByRole('button', { name: label, exact: true });

        await expect(control).toBeInViewport({ ratio: 1 });
        await control.click({ trial: true });
      }

      await expect(composer).toBeInViewport({ ratio: 1 });
      await composer.click({ trial: true });
    }

    async function openSource(name: string, expected: string, occurrence = 0) {
      const attachment = entry.getByRole('button', { name, exact: true }).nth(occurrence);

      await attachment.scrollIntoViewIfNeeded();
      await attachment.click();
      await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(preview).toHaveAttribute('contenteditable', 'false');
      await expect(preview.getByText(expected, { exact: true })).toBeVisible();
      await expect(panel.getByText(copy.NotePending, { exact: true })).toHaveCount(0);
    }

    await page.goto('/notes');
    await expect(noteLinks).toHaveCount(0);
    await composer.fill(original);
    await page.getByLabel(copy.NoteAttachFiles, { exact: true }).setInputFiles([
      ...localFiles.map((file) => ({
        name: file.name,
        mimeType: file.name.endsWith('.md') ? 'text/markdown' : 'text/plain',
        buffer: Buffer.from(file.text)
      })),
      ...(await Promise.all(
        ['sample.pptx', 'interleaved.pptx', 'sample.docx', 'two-pages.pdf'].map(async (name) => ({
          name,
          mimeType: 'application/octet-stream',
          buffer: Buffer.from(await Bun.file(new URL(name, fixtureDirectory)).arrayBuffer())
        }))
      )),
      {
        name: 'unsupported.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from([0, 255, 1, 254, 2, 253])
      }
    ]);

    const queue = page.getByRole('region', { name: copy.NoteCompose, exact: true });

    await expect(queue.getByRole('button', { name: copy.NoteRemoveAttachment })).toHaveCount(10);
    await expect(queue.getByText('duplicate.txt', { exact: true })).toHaveCount(2);
    await expect(composer).toHaveValue(original);
    await expect(save).toBeEnabled();
    await queue.getByText('coastal-evidence.md', { exact: true }).scrollIntoViewIfNeeded();
    await expectScreenshot('mixed-queue', {
      target: 'viewport',
      ready: async () => {
        for (const name of new Set(names))
          for (const item of await queue.getByText(name, { exact: true }).all())
            await expect(item).toBeInViewport({ ratio: 1 });

        await expect(composer).toHaveValue(original);
        await expect(save).toBeEnabled();
      }
    });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport({ ratio: 1 });
    await save.click({ trial: true });
    await save.click();
    await expect(page).toHaveURL(/\/notes\/[^/?]+$/);

    const noteUrl = page.url();

    await expect(noteLinks).toHaveCount(1);
    await expect(body).toHaveText(original);
    await identities();

    // Edit immediately after the committed save; no artificial decoder delay is introduced.
    await entry.hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();

    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });

    const edited = original
      .replace('Mixed attachment field lecture', 'Mixed attachment field lecture — corrected')
      .replace(last, correctedLast);

    await expect(dialog.getByRole('textbox')).toHaveValue(original);
    await dialog.getByRole('textbox').fill(edited);
    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(dialog).toBeHidden();
    await expect(body).toHaveText(edited);
    await identities();

    for (const [index, file] of localFiles.entries()) {
      await openSource(file.name, file.expected, index === 3 ? 1 : 0);

      if (file.name === 'duplicate.txt') {
        await expect(
          preview.getByText(localFiles[index === 2 ? 3 : 2]!.expected, { exact: true })
        ).toHaveCount(0);
      }
    }

    for (const [name, text] of [
      ['sample.pptx', 'Speaker notes'],
      ['interleaved.pptx', 'Cell'],
      ['sample.docx', 'First paragraph']
    ] as const)
      await openSource(name, text);

    await entry.getByRole('button', { name: 'unsupported.bin', exact: true }).click();
    await expect(
      panel.getByRole('heading', { name: 'unsupported.bin', exact: true })
    ).toBeVisible();
    await expect(panel.getByText(copy.SourceExtractionUnsupported, { exact: true })).toBeVisible();
    await expect(panel.getByText(copy.NotePending, { exact: true })).toHaveCount(0);
    await expectScreenshot('partial-extraction-failure', {
      target: 'viewport',
      ready: async () => {
        await expect(
          panel.getByText(copy.SourceExtractionUnsupported, { exact: true })
        ).toBeVisible();
        await expect(body).toHaveText(edited);
      }
    });
    await entry.getByRole('button', { name: 'two-pages.pdf', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'two-pages.pdf', exact: true })).toBeVisible();
    await expect(panel.getByText(copy.NoteWaitAuth, { exact: true })).toBeVisible();
    await expect(panel.getByText(copy.NotePending, { exact: true })).toHaveCount(0);
    await panel.getByRole('link', { name: copy.Settings, exact: true }).click({ trial: true });
    await expectScreenshot('pdf-awaits-sign-in', {
      target: 'viewport',
      ready: async () => {
        await expect(panel.getByText(copy.NoteWaitAuth, { exact: true })).toBeVisible();
        await expect(
          panel.getByRole('heading', { name: 'two-pages.pdf', exact: true })
        ).toBeVisible();
      }
    });
    await openSource('summary.md', localFiles[4]!.expected);

    await page.goto('/projects');
    await page.goto(noteUrl);
    await page.reload();
    await expect(noteLinks).toHaveCount(1);
    await expect(body).toHaveText(edited);
    await identities();

    async function inspectLecture() {
      const label = entry.getByText(copy.NoteEntryNote, { exact: true });

      await label.scrollIntoViewIfNeeded();
      await expect(label).toBeInViewport({ ratio: 1 });

      const scrollHost = page.locator('[data-notebook-scroll-host]');

      const top = await body.boundingBox();

      if (!top) throw new Error('Lecture has no layout box');

      await expect(body).toHaveVisibleText('Mixed attachment field lecture — corrected');
      await expect(body).not.toHaveVisibleText(middle);
      await expect(body).not.toHaveVisibleText(correctedLast);
      await scrollHost.click();

      // Ordinary keyboard scrolling; the harness assertion only reads the exact rendered range.
      for (const text of [middle, correctedLast]) {
        await expect(async () => {
          for (let step = 0; step < 4; step++) await scrollHost.press('ArrowDown');

          await expect(body).toHaveVisibleText(text, { timeout: 250 });

          if (text === correctedLast) {
            const lecture = await body.boundingBox();
            const floating = await page.locator('.workspace-desk-floating-composer').boundingBox();

            expect(!!lecture && !!floating && lecture.y + lecture.height <= floating.y).toBe(true);
          }
        }).toPass({ timeout: 30_000, intervals: [0] });
        await expect.poll(async () => (await body.boundingBox())?.y).toBeLessThan(top.y);
        await expect(composer).toBeInViewport({ ratio: 1 });
        await composer.click({ trial: true });
        // Return keyboard ownership to the scroll host after checking the composer.
        await scrollHost.click();
      }

      await expect(label).not.toBeInViewport();
      await expect(body).not.toHaveVisibleText('Mixed attachment field lecture — corrected');
      await expect(body).not.toHaveVisibleText(middle);
      await expect(body).toHaveVisibleText(correctedLast);
      await expect
        .poll(async () => {
          const lecture = await body.boundingBox();
          const floating = await page.locator('.workspace-desk-floating-composer').boundingBox();

          return !!lecture && !!floating && lecture.y + lecture.height <= floating.y;
        })
        .toBe(true);
      await expect(body).toHaveText(edited);
      await composer.click({ trial: true });
    }

    await inspectLecture();

    await openSource('coastal-evidence.md', 'Coastal evidence');
    await controls();
    await expectScreenshot('completed-source', {
      target: 'viewport',
      ready: async () => {
        await expect(
          preview.getByText('Source beginning: the lighthouse marks the first observation.', {
            exact: true
          })
        ).toBeInViewport({ ratio: 1 });
        await expect(body).toHaveText(edited);
      }
    });

    const first = preview.getByText(
      'Source beginning: the lighthouse marks the first observation.',
      { exact: true }
    );

    const center = preview.getByText(sourceMiddle, { exact: true });

    const bottom = preview.getByText(sourceLast, { exact: true });

    const firstBox = await first.boundingBox();

    if (!firstBox) throw new Error('Source beginning has no layout box');

    await expect(bottom).not.toBeInViewport();
    await center.scrollIntoViewIfNeeded();
    await expect(center).toBeInViewport({ ratio: 1 });
    await expect(first).not.toBeInViewport();
    await expect.poll(async () => (await first.boundingBox())?.y).toBeLessThan(firstBox.y);
    await controls();
    await expectScreenshot('long-source-middle', {
      target: 'viewport',
      ready: () => expect(center).toBeInViewport({ ratio: 1 })
    });
    await bottom.scrollIntoViewIfNeeded();
    await expect(bottom).toBeInViewport({ ratio: 1 });
    await expect(center).not.toBeInViewport();
    await bottom.click({ trial: true });
    await controls();
    await expectScreenshot('long-source-bottom', {
      target: 'viewport',
      ready: () => expect(bottom).toBeInViewport({ ratio: 1 })
    });

    for (const file of localFiles.filter((file) => file.name === 'duplicate.txt'))
      await openSource(file.name, file.expected, file === localFiles[2] ? 0 : 1);

    await expect(body).toHaveText(edited);
    await identities();
  }
);
