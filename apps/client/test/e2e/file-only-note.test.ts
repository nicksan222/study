import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const files = [
  {
    name: 'river-survey.md',
    title: 'River survey source',
    first: 'River sentinel: the first survey measured twelve willow trees.',
    last: 'River conclusion: retain the original bank measurements.'
  },
  {
    name: 'orchard-inventory.md',
    title: 'Orchard inventory source',
    first: 'Orchard sentinel: seven pear trees need a second inspection.',
    last: 'Orchard conclusion: count the eastern row again in spring.'
  },
  {
    name: 'coastal-fieldbook.md',
    title: 'Coastal fieldbook source',
    first: 'Coastal beginning sentinel: the lighthouse marks the first observation.',
    last: 'Coastal final sentinel: the final tide reading completes this fieldbook.'
  }
];

const middle = 'Coastal middle sentinel: compare the sheltered cove with the exposed beach.';

const observations = Array.from(
  { length: 30 },
  (_, index) =>
    `## Coastal station ${index + 1}\n\n` +
    `Station ${index + 1} records the water level beside the coastal path. The survey team checks the same marked post before collecting sand samples. Keep these measurements with the original fieldbook so another team can repeat the route and compare the shoreline after the next storm.\n\n` +
    (index === 14 ? `${middle}\n\n` : '') +
    '- Record the time and water level.\n- Preserve the location of the marked post.'
);

test.stable('Create and reopen three file-only notes', async ({ page, expectScreenshot }) => {
  const composer = page.getByRole('textbox', { name: copy.NoteCompose });
  const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
  const noteLinks = page.locator('a[href^="/notes/"]');
  const panel = page.getByRole('tabpanel');
  const preview = panel.getByRole('document', { name: copy.NotePageEditor });
  const urls: string[] = [];

  async function sourceReady(file: (typeof files)[number]) {
    await test.expect(panel.getByRole('heading', { name: file.name, exact: true })).toBeVisible();
    await test.expect(preview).toBeVisible();
    await test.expect(preview).toHaveAttribute('contenteditable', 'false');
    await test
      .expect(preview.getByRole('heading', { name: file.title, exact: true }))
      .toBeVisible();
    await test.expect(preview.getByText(file.first, { exact: true })).toBeVisible();
    await test.expect(preview.getByText(file.last, { exact: true })).toBeVisible();
    await test.expect(panel.getByText(copy.NotePending, { exact: true })).toHaveCount(0);
    await test
      .expect(panel.getByRole('button', { name: copy.PageEditCopy, exact: true }))
      .toBeEnabled();

    for (const other of files.filter((entry) => entry !== file)) {
      await test.expect(preview.getByText(other.first, { exact: true })).toHaveCount(0);
      await test.expect(page.getByRole('button', { name: other.name, exact: true })).toHaveCount(0);
    }
  }

  async function previewControls() {
    const close = page.getByRole('button', { name: copy.NoteClosePage, exact: true });
    const expand = page.getByRole('button', { name: copy.NoteExpandEditor, exact: true });

    for (const control of [close, expand]) {
      await test.expect(control).toBeInViewport({ ratio: 1 });
      await control.click({ trial: true });
    }
  }

  async function scrollLongSource(file: (typeof files)[number]) {
    const first = preview.getByText(file.first, { exact: true });
    const center = preview.getByText(middle, { exact: true });
    const last = preview.getByText(file.last, { exact: true });
    const topBox = await first.boundingBox();

    if (!topBox) throw new Error('Source beginning has no layout box');

    await test.expect(last).not.toBeInViewport();
    await center.scrollIntoViewIfNeeded();
    await test.expect(center).toBeInViewport({ ratio: 1 });
    await test.expect(first).not.toBeInViewport();
    await test.expect.poll(async () => (await first.boundingBox())?.y).toBeLessThan(topBox.y);
    await previewControls();
    await expectScreenshot('long-source-middle', {
      target: 'viewport',
      ready: () => test.expect(center).toBeInViewport({ ratio: 1 })
    });

    const middleBox = await center.boundingBox();

    if (!middleBox) throw new Error('Source middle has no layout box');

    await last.scrollIntoViewIfNeeded();
    await test.expect(last).toBeInViewport({ ratio: 1 });
    await test.expect(center).not.toBeInViewport();
    await test.expect.poll(async () => (await center.boundingBox())?.y).toBeLessThan(middleBox.y);
    await test.expect(preview.locator('pre')).toContainText('survey_completed = true');
    await previewControls();
    await last.click({ trial: true });
    await expectScreenshot('long-source-bottom', {
      target: 'viewport',
      ready: () => test.expect(last).toBeInViewport({ ratio: 1 })
    });
  }

  for (const [index, file] of files.entries()) {
    await page.goto('/notes');
    await test.expect(noteLinks).toHaveCount(index);
    await test.expect(composer).toHaveValue('');
    await test.expect(save).toBeDisabled();

    const markdown = [
      `# ${file.title}`,
      file.first,
      ...(index === 2 ? observations : ['- Measure the marked row.\n- Keep the original record.']),
      '```text\nsurvey_completed = true\n```',
      file.last
    ].join('\n\n');

    await page.getByLabel(copy.NoteAttachFiles, { exact: true }).setInputFiles({
      name: file.name,
      mimeType: 'text/markdown',
      buffer: Buffer.from(markdown)
    });
    await test.expect(composer).toHaveValue('');
    await test
      .expect(
        page
          .getByRole('region', { name: copy.NoteCompose, exact: true })
          .getByText(file.name, { exact: true })
      )
      .toBeVisible();
    await test.expect(save).toBeEnabled();
    await test.expect(save).toBeInViewport({ ratio: 1 });
    await save.click({ trial: true });

    if (index === 0) {
      await expectScreenshot('file-draft', {
        target: 'viewport',
        ready: async () => {
          await test.expect(composer).toHaveValue('');
          await test.expect(save).toBeEnabled();
          await test
            .expect(
              page
                .getByRole('region', { name: copy.NoteCompose, exact: true })
                .getByText(file.name, { exact: true })
            )
            .toBeVisible();
        }
      });
    }

    await save.click();
    await test.expect(page).toHaveURL(/\/notes\/[^/?]+$/);
    test.expect(urls).not.toContain(page.url());
    urls.push(page.url());
    await test.expect(noteLinks).toHaveCount(index + 1);
    await test.expect(composer).toHaveValue('');
    await test.expect(page.locator('[data-slot="chat-message-text"]')).toHaveCount(1);
    await test.expect(page.locator('[data-slot="chat-message-text"]')).toHaveText('');

    const attachment = page.locator('[data-role="user"]').getByRole('button', {
      name: file.name,
      exact: true
    });

    await test.expect(attachment).toBeEnabled();
    await attachment.click();
    await sourceReady(file);
    await previewControls();

    const first = preview.getByText(file.first, { exact: true });

    await first.scrollIntoViewIfNeeded();
    await test.expect(first).toBeInViewport({ ratio: 1 });
    await first.click();
    await first.press('x');
    await test.expect(first).toHaveText(file.first);
    await test.expect(preview).toHaveAttribute('contenteditable', 'false');

    if (index === 0) {
      await expectScreenshot('created-attachment', {
        target: 'viewport',
        ready: async () => {
          await sourceReady(file);
          await test.expect(preview).toHaveAttribute('contenteditable', 'false');
        }
      });
    }

    if (index === 2) await scrollLongSource(file);

    const original = panel.getByRole('button', { name: copy.ReaderOriginal, exact: true });
    const editCopy = panel.getByRole('button', { name: copy.PageEditCopy, exact: true });

    for (const control of [original, editCopy]) {
      await control.scrollIntoViewIfNeeded();
      await test.expect(control).toBeInViewport({ ratio: 0.999 });

      const box = await control.boundingBox();

      if (!box) throw new Error('Source control has no layout box');

      // App zoom can round the full-width control's outer border by a physical pixel.
      test.expect(box.x).toBeGreaterThanOrEqual(-1);
      test.expect(box.y).toBeGreaterThanOrEqual(-1);
      test.expect(box.x + box.width).toBeLessThanOrEqual(2561);
      test.expect(box.y + box.height).toBeLessThanOrEqual(1441);
      await control.click({ trial: true });
    }
  }

  const oldest = files[0]!;

  await page.goto('/notes');
  await test.expect(noteLinks).toHaveCount(3);
  await page.locator(`a[href="${new URL(urls[0]!).pathname}"]`).click();
  await test.expect(page).toHaveURL(urls[0]!);
  await page.locator('[data-role="user"]').getByRole('button', { name: oldest.name }).click();
  await sourceReady(oldest);
  await page.reload();
  await test.expect(page).toHaveURL(urls[0]!);
  await test.expect(noteLinks).toHaveCount(3);
  await page.locator('[data-role="user"]').getByRole('button', { name: oldest.name }).click();
  await sourceReady(oldest);
  await previewControls();
  await page.goto('/notes');
  await page.reload();
  await test.expect(noteLinks).toHaveCount(3);
});
