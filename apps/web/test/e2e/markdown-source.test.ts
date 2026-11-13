import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;
const top = 'Top sentinel: città and the river begin here.';
const middle = 'Middle sentinel: 東京 gauge fifty is verified.';
const bottom = 'Bottom sentinel: the survey is complete — fine.';
const sections = Array.from(
  { length: 100 },
  (_, index) =>
    `## Station ${index + 1}\n\nStation ${index + 1} recorded the river level with \`gauge_${index + 1}\`.\n\n` +
    (index === 49 ? `${middle}\n\n` : '') +
    `- Check gauge ${index + 1}\n  - Retain the original reading\n\n` +
    `| Site | Result |\n| --- | --- |\n| Bank ${index + 1} | ${index + 1} cm |\n\n` +
    `\`\`\`text\nreading_${index + 1} = verified\n\`\`\``
);
const markdown = [
  '# River fieldbook',
  top,
  '[Reference](https://example.com/fieldbook)',
  '[Unsafe](javascript:alert(1))',
  '<script>window.fieldbookScriptExecuted = true</script>',
  ...sections,
  bottom
].join('\n\n');

testE2e('Read and reopen a long Markdown attachment', async ({ page, expectScreenshot }) => {
  const original = Buffer.from(markdown);

  await page.goto('/notes');
  const composer = page.getByRole('textbox', { name: copy.NoteCompose });
  await composer.fill('River fieldbook parent note.');
  await page.getByLabel(copy.NoteAttachFiles, { exact: true }).setInputFiles({
    name: 'river-fieldbook.md',
    mimeType: 'text/markdown',
    buffer: original
  });
  await page.getByRole('button', { name: copy.NoteSaveNote, exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/[^/?]+$/);
  const identity = page.url();
  const entry = page.locator('[data-role="user"]');
  const body = entry.locator('.chat-message-text');
  const attachment = entry.getByRole('button', { name: 'river-fieldbook.md', exact: true });
  const panel = page.getByRole('tabpanel');
  const preview = panel.getByRole('document', { name: copy.NotePageEditor });

  async function sourceIdentity(expectedHref?: string) {
    await attachment.click({ button: 'right' });
    const link = page.getByRole('menuitem', { name: copy.OpenInLibrary, exact: true });

    await expect(link).toHaveAttribute('href', /^\/sources\/[1-9][0-9]*$/);

    if (expectedHref !== undefined) await expect(link).toHaveAttribute('href', expectedHref);

    const href = (await link.getAttribute('href'))!;

    await link.press('Escape');
    await expect(link).toBeHidden();

    return href;
  }

  async function originalRetained() {
    const download = page.waitForEvent('download');

    await panel.getByRole('button', { name: copy.ReaderOriginal, exact: true }).click();
    const result = await download;

    expect(await result.failure()).toBeNull();
    expect(result.suggestedFilename()).toBe('river-fieldbook.md');
    const path = await result.path();

    expect(path).not.toBeNull();
    expect(Buffer.from(await Bun.file(path!).arrayBuffer())).toEqual(original);
  }

  await attachment.click();
  await expect(
    panel.getByRole('heading', { name: 'river-fieldbook.md', exact: true })
  ).toBeVisible();
  await expect(preview).toHaveAttribute('contenteditable', 'false');
  await expect(preview.getByRole('heading')).toHaveText([
    'River fieldbook',
    ...Array.from({ length: 100 }, (_, index) => `Station ${index + 1}`)
  ]);
  await expect(
    preview
      .getByRole('listitem')
      .filter({ has: page.getByText('Check gauge 50', { exact: true }) })
      .getByRole('listitem')
  ).toHaveText('Retain the original reading');
  const sourceHref = await sourceIdentity();

  await expect(panel.getByText(copy.ReaderOmissions)).toBeVisible();
  await expect(panel.getByText(copy.ReaderOmitMarkup, { exact: true })).toBeVisible();
  await expect(preview.getByRole('link', { name: 'Reference' })).toHaveAttribute(
    'href',
    'https://example.com/fieldbook'
  );
  await expect(preview.getByText('[Unsafe](javascript:alert(1))', { exact: true })).toBeVisible();
  await expect(preview.locator('a[href^="javascript:"], script')).toHaveCount(0);
  await expect(
    preview.getByText('<script>window.fieldbookScriptExecuted = true</script>', { exact: true })
  ).toBeVisible();
  const first = preview.getByText(top, { exact: true });
  const center = preview.getByText(middle, { exact: true });
  const last = preview.getByText(bottom, { exact: true });
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport({ ratio: 1 });
  await expectScreenshot('markdown-top', {
    target: 'viewport',
    ready: () => expect(first).toBeInViewport({ ratio: 1 })
  });
  await center.scrollIntoViewIfNeeded();
  await expect(center).toBeInViewport({ ratio: 1 });
  await expect(first).not.toBeInViewport();
  const table = preview.getByRole('table').filter({ hasText: 'Bank 50' });
  await expect(table).toContainText('50 cm');
  const code = preview.locator('pre').filter({ hasText: 'reading_50 = verified' });
  await expect(code).toHaveCount(1);
  await code.scrollIntoViewIfNeeded();
  await expect(code).toBeInViewport({ ratio: 1 });
  await expect(table).toBeInViewport({ ratio: 1 });
  await expectScreenshot('table-and-code', {
    target: 'viewport',
    ready: async () => {
      await expect(table).toBeInViewport({ ratio: 1 });
      await expect(code).toBeInViewport({ ratio: 1 });
    }
  });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(center).not.toBeInViewport();
  await expectScreenshot('markdown-bottom', {
    target: 'viewport',
    ready: () => expect(last).toBeInViewport({ ratio: 1 })
  });

  await entry.hover();
  await page.getByRole('button', { name: copy.NoteEditNote }).click();
  const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
  await expect(dialog.getByRole('textbox')).toHaveValue('River fieldbook parent note.');
  await dialog.getByRole('textbox').fill('River fieldbook parent note — corrected.');
  await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
  await expect(dialog).toBeHidden();
  await expect(body).toHaveText('River fieldbook parent note — corrected.');
  await expect(page).toHaveURL(identity);
  await page.getByRole('button', { name: copy.NoteClosePage, exact: true }).click();
  await attachment.click();
  await expect(preview.getByText(top, { exact: true })).toBeVisible();
  await sourceIdentity(sourceHref);
  await originalRetained();
  await page.reload();
  await expect(page).toHaveURL(identity);
  await expect(body).toHaveText('River fieldbook parent note — corrected.');
  await expect(attachment).toHaveCount(1);
  await attachment.click();
  await expect(preview).toHaveAttribute('contenteditable', 'false');
  await expect(preview.getByText(bottom, { exact: true })).toBeVisible();
  await sourceIdentity(sourceHref);
  await originalRetained();
});
