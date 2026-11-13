import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

const longLine = `Field-observation-long-${'x'.repeat(1024)}-END`;

const lines = Array.from({ length: 5000 }, (_, index) => {
  if (index === 0) return 'Field observation first: città e 東京';

  if (index === 2499) return longLine;

  if (index === 4999) return 'Field observation final: arrivederci Ω';

  return `Field observation line ${String(index + 1).padStart(4, '0')}: café`;
});

// Blank lines delimit blocks so each landmark can be scrolled into view.
const text = lines.join('\n\n');

testE2e('Read and retain TXT and LOG attachments', async ({ page, expectScreenshot }) => {
  const composer = page.getByRole('textbox', { name: copy.NoteCompose });
  const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
  const panel = page.getByRole('tabpanel');
  const preview = panel.getByRole('document', { name: copy.NotePageEditor });
  const files = ['field-observations.txt', 'field-events.log'];
  const noteLinks = page.locator('a[href^="/notes/"]');
  const entries = page.locator('[data-role="user"]');
  const attachmentAnchors = entries.locator('[id*="-attachment-"]');
  const retained: {
    name: string;
    noteUrl: string;
    sourceHref: string;
    attachmentAnchor: string;
  }[] = [];

  async function sourceIdentity(name: string, expectedHref?: string) {
    await entries.getByRole('button', { name, exact: true }).click({ button: 'right' });
    const link = page.getByRole('menuitem', { name: copy.OpenInLibrary, exact: true });

    await expect(link).toHaveAttribute('href', /^\/sources\/[1-9][0-9]*$/);

    if (expectedHref !== undefined) await expect(link).toHaveAttribute('href', expectedHref);

    const href = (await link.getAttribute('href'))!;
    const sourceUrl = new URL(href, page.url()).href;

    if (name === files[0] && expectedHref === undefined) {
      const menu = page.getByRole('menu');

      await expectScreenshot('source-menu', {
        target: menu,
        ready: async () => {
          await expect(menu).toHaveCount(1);
          await expect(menu).toBeVisible();
          await expect(link).toHaveCount(1);
          await expect(link).toHaveAttribute('href', href);
          await link.click({ trial: true });
        }
      });
    }

    await link.click();
    await expect(page).toHaveURL(sourceUrl);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    const reader = page.getByRole('document', { name: copy.NotePageEditor });
    const paragraphs = reader.getByRole('paragraph');

    await expect(reader).toHaveAttribute('contenteditable', 'false');
    await expect(paragraphs).toHaveText(lines);
    expect(await paragraphs.allTextContents()).toEqual(lines);

    return href;
  }

  async function openSource(name: string, noteUrl: string, attachmentAnchor: string) {
    await expect(page).toHaveURL(noteUrl);
    await expect(noteLinks).toHaveCount(retained.length);
    await expect(entries).toHaveCount(1);
    await expect(entries.locator('[data-slot="chat-message-text"]')).toHaveText('');
    await expect(attachmentAnchors).toHaveCount(1);
    await expect(attachmentAnchors).toHaveAttribute('id', attachmentAnchor);
    await page.locator('[data-role="user"]').getByRole('button', { name, exact: true }).click();
    await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(preview).toHaveAttribute('contenteditable', 'false');
    await expect(panel.getByText(copy.NotePending, { exact: true })).toHaveCount(0);
    // Compare rendered paragraphs individually; DOM text does not retain blank-line separators.
    const paragraphs = preview.getByRole('paragraph');

    await expect(paragraphs).toHaveText(lines);
    expect(await paragraphs.allTextContents()).toEqual(lines);
  }

  for (const [index, name] of files.entries()) {
    await page.goto('/notes');
    await expect(noteLinks).toHaveCount(index);
    await expect(composer).toHaveValue('');
    await page.getByLabel(copy.NoteAttachFiles, { exact: true }).setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(text, 'utf8')
    });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/\/notes\/[^/?]+$/);
    const noteUrl = page.url();

    expect(retained.map((note) => note.noteUrl)).not.toContain(noteUrl);
    await expect(noteLinks).toHaveCount(index + 1);
    await expect(attachmentAnchors).toHaveCount(1);
    // Notebook attachment anchors identify message parts, independently of source links.
    const attachmentAnchor = (await attachmentAnchors.getAttribute('id'))!;
    const sourceHref = await sourceIdentity(name);

    expect(retained.map((note) => note.sourceHref)).not.toContain(sourceHref);
    retained.push({ name, noteUrl, sourceHref, attachmentAnchor });
    await page.goto(noteUrl);
    await openSource(name, noteUrl, attachmentAnchor);
    const first = preview.getByText('Field observation first: città e 東京');
    const middle = preview.getByText(longLine);
    const last = preview.getByText('Field observation final: arrivederci Ω');

    await first.scrollIntoViewIfNeeded();
    await expect(preview).toHaveVisibleText('Field observation first: città e 東京');

    if (name === files[0]) {
      await expectScreenshot('source-top', {
        target: 'viewport',
        ready: () => expect(preview).toHaveVisibleText('Field observation first: città e 東京')
      });
    }

    await middle.scrollIntoViewIfNeeded();
    await expect(preview).toHaveVisibleText('Field-observation-long-');

    if (name === files[0]) {
      await expectScreenshot('long-line', {
        target: 'viewport',
        ready: () => expect(preview).toHaveVisibleText('Field-observation-long-')
      });
    }

    await last.scrollIntoViewIfNeeded();
    await expect(preview).toHaveVisibleText('Field observation final: arrivederci Ω');

    if (name === files[0]) {
      await expectScreenshot('source-bottom', {
        target: 'viewport',
        ready: () => expect(preview).toHaveVisibleText('Field observation final: arrivederci Ω')
      });
    }

    const downloadPromise = page.waitForEvent('download');

    await panel.getByRole('button', { name: copy.ReaderOriginal, exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(name);
    const path = await download.path();

    expect(new Uint8Array(await Bun.file(path).arrayBuffer())).toEqual(
      new Uint8Array(Buffer.from(text, 'utf8'))
    );

    await page.getByRole('button', { name: copy.NoteClosePage, exact: true }).click();
    await openSource(name, noteUrl, attachmentAnchor);
    await sourceIdentity(name, sourceHref);
    await page.goto(noteUrl);
    await page.reload();
    await openSource(name, noteUrl, attachmentAnchor);
    await sourceIdentity(name, sourceHref);
  }

  for (const { name, noteUrl, sourceHref, attachmentAnchor } of retained) {
    await page.goto('/notes');
    await expect(noteLinks).toHaveCount(files.length);
    await page.locator(`a[href="${new URL(noteUrl).pathname}"]`).click();
    await openSource(name, noteUrl, attachmentAnchor);
    await sourceIdentity(name, sourceHref);
    await page.goto(noteUrl);
    await page.reload();
    await openSource(name, noteUrl, attachmentAnchor);
    await sourceIdentity(name, sourceHref);
  }
});
