import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({ video: 'on' });

test.browser.stable(
  'Writes and autosaves a single notebook page',
  async ({ page, expect, expectScreenshot }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });
    const title = page.getByRole('textbox', { name: copy.NoteName });
    const saveNote = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
    const autosave = page
      .getByRole('status')
      .filter({ hasText: new RegExp(`^${copy.NoteAutosaved}$`) });

    await expect(saveNote).toHaveCount(0);
    await expect(starter).toBeVisible();
    await starter.click({ position: { x: 40, y: 300 } });
    await expect(starter).toBeFocused();
    await page.keyboard.insertText('River field notes');
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('River field notes');
    await expect(saveNote).toHaveCount(0);
    await expectScreenshot('desktop-writing-page', {
      target: 'viewport',
      ready: () => expect(autosave).toBeVisible()
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await title.fill('River field observations and end-of-season measurements');
    await title.press('Enter');
    await expect(title).not.toBeFocused();
    await expect(title).toHaveValue('River field observations and end-of-season measurements');
    await expect.poll(async () => (await title.boundingBox())?.height ?? 0).toBeGreaterThan(60);
    await editor.fill('River field notes revised');
    // Reload while the draft is dirty so local recovery is exercised as well as durable save.
    await page.reload();
    await expect(editor).toHaveText('River field notes revised');
    await expectScreenshot('phone-writing-page', {
      target: 'viewport',
      ready: () => expect(autosave).toBeVisible()
    });
    await page.reload();
    await expect(editor).toHaveText('River field notes revised');

    await editor.fill('');
    await expect(autosave).toBeVisible();
    await page.reload();
    await expect(editor).toHaveText('');
    await expect(saveNote).toHaveCount(0);
  }
);
