import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Notes preserve multiple edits after reopening',
  async ({ page, expectScreenshot, expect }) => {
    const content = Array.from(
      { length: 24 },
      (_, i) =>
        'Paragraph ' +
        (i + 1) +
        ': a durable notebook entry with enough text to exercise scrolling and editing.'
    ).join('\n\n');

    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });
    const saved = page
      .getByRole('status')
      .filter({ hasText: new RegExp('^' + copy.NoteAutosaved + '$') });

    await starter.fill(content);
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await expect(editor).toHaveText(content, { useInnerText: true });
    const noteUrl = page.url();

    await page.reload();
    await expectScreenshot('first-autosave', {
      target: 'viewport',
      ready: () => expect(editor).toHaveText(content, { useInnerText: true })
    });

    const amended = content + '\n\nAn edited note';

    await editor.fill(amended);
    await expect(editor).toHaveText(amended, { useInnerText: true });
    await expect(saved).toBeVisible();
    const ending = editor.getByText('An edited note', { exact: true });

    await ending.scrollIntoViewIfNeeded();
    await expectScreenshot('editing', {
      target: 'viewport',
      ready: () => expect(ending).toBeInViewport()
    });
    await page.reload();
    await expect(page).toHaveURL(noteUrl);
    await expect(editor).toHaveText(amended, { useInnerText: true });

    await editor.fill('A second edit after reopening');
    await expect(saved).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(noteUrl);
    await expectScreenshot('reopened', {
      target: 'viewport',
      ready: () => expect(editor).toHaveText('A second edit after reopening')
    });
  }
);
