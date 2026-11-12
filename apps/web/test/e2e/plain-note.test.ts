import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

const paragraphs = Array.from(
  { length: 20 },
  (_, index) =>
    `Field observation ${index + 1}. ` +
    'The morning team walked beside the river and recorded the water level before opening the garden gates. Each observation belongs to this notebook and remains useful when we compare the seasons. We measured the shaded path, counted the young trees, and checked the wooden bridge for damage. The afternoon group will repeat these steps with the same equipment so that our records stay consistent. Clear paragraphs help every reader find the original evidence without guessing what changed. We keep the complete account because small details often explain a surprising result during the next visit.'
);

const original = ['River garden field notebook', ...paragraphs].join('\n\n');

testE2e('Create edit and reopen a plain note', async ({ page, expectScreenshot }) => {
  await page.goto('/notes');
  expect(page.viewportSize()).toEqual({ width: 2560, height: 1440 });
  const composer = page.getByRole('textbox', { name: copy.NoteCompose });

  await composer.fill(original);
  await page.getByRole('button', { name: copy.NoteSaveNote }).click();
  await expect(page).toHaveURL(/\/notes\/.+/);
  const noteUrl = page.url();
  const notebook = page.getByRole('region', { name: copy.NoteNotebook });
  const body = notebook.locator('.chat-message-text');
  const entryLabel = notebook.getByText(copy.NoteEntryNote, { exact: true });

  await expect(body).toHaveText(original);
  await entryLabel.scrollIntoViewIfNeeded();
  await expect(entryLabel).toBeInViewport({ ratio: 1 });
  await expectScreenshot('saved-top', {
    target: 'viewport',
    ready: async () => {
      await expect(body).toHaveText(original);
      await expect(entryLabel).toBeInViewport({ ratio: 1 });
    }
  });

  let content = original;

  for (const [before, after] of [
    ['Field observation 1.', 'Field observation 1: water level corrected.'],
    ['Field observation 11.', 'Field observation 11: bridge inspection corrected.'],
    ['Field observation 20.', 'Field observation 20: final count corrected.']
  ]) {
    await notebook.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    await expect(editor).toHaveValue(content);
    content = content.replace(before!, after!);
    await editor.fill(content);

    if (before === 'Field observation 11.') {
      await editor.press('ControlOrMeta+a');
      await editor.press('ArrowLeft');

      // Move past observation 11 so its corrected paragraph is visible above the caret.
      for (let paragraph = 0; paragraph < 23; paragraph++) await editor.press('Control+ArrowDown');

      await expect(editor).toBeFocused();
      await expect(editor.locator(':scope:focus-visible')).toHaveCount(1);
      await editor.press('Tab');
      const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

      await expect(save).toBeFocused();
      await expect(save).toBeInViewport({ ratio: 1 });
      await expect(save).toHaveCSS('--tw-ring-inset', 'inset');
      await save.press('Shift+Tab');
      await expect(editor).toBeFocused();
      await expectScreenshot('editing-middle', {
        target: dialog,
        ready: async () => {
          await expect(editor).toHaveValue(content);
        }
      });
    }

    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(dialog).toBeHidden();
    await expect(body).toHaveText(content);
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/projects/);
    await page.goBack();
    await expect(page).toHaveURL(noteUrl);
    await expect(body).toHaveText(content);
  }

  await page.reload();
  await expect(body).toHaveText(content);
  await expect(notebook.locator('[data-role="assistant"]')).toHaveCount(0);
  await expect(notebook.locator('[data-role="user"]')).toHaveCount(1);
  const scrollHost = page.locator('[data-notebook-scroll-host]');

  await entryLabel.scrollIntoViewIfNeeded();
  await expect(entryLabel).toBeInViewport({ ratio: 1 });
  await scrollHost.press('End');
  await expect(entryLabel).not.toBeInViewport();
  await expect(body).toBeInViewport();
  await expect(composer).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: copy.NoteSaveNote })).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const bodyBox = await body.boundingBox();
      const composerBox = await page.locator('.workspace-desk-floating-composer').boundingBox();

      return !!bodyBox && !!composerBox && bodyBox.y + bodyBox.height <= composerBox.y;
    })
    .toBe(true);
  await expect(scrollHost).toBeFocused();
  await expect(scrollHost).toHaveCSS('outline-style', 'none');
  await expectScreenshot('reopened-bottom', {
    target: 'viewport',
    ready: async () => {
      await expect(body).toHaveText(content);
    }
  });
  await composer.click();
  await composer.press('ArrowLeft');
  await expect(composer).toBeFocused();
  await notebook.locator('[data-role="user"]').hover();
  await page.getByRole('button', { name: copy.NoteEditNote }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: copy.NoteEditNote })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: copy.NoteEditNote }).click();
  await expect(
    page.getByRole('dialog', { name: copy.NoteEditNote }).getByRole('textbox')
  ).toHaveValue(content);
  await page.goto('/notes');
  await expect(
    page.getByRole('navigation', { name: copy.Notes, exact: true }).locator('a[href^="/notes/"]')
  ).toHaveCount(1);
  await expect(page.locator('a[href="' + new URL(noteUrl).pathname + '"]')).toHaveCount(1);
});
