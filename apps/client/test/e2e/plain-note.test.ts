import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const paragraphs = Array.from(
  { length: 20 },
  (_, index) =>
    `Field observation ${index + 1}. ` +
    'The morning team walked beside the river and recorded the water level before opening the garden gates. Each observation belongs to this notebook and remains useful when we compare the seasons. We measured the shaded path, counted the young trees, and checked the wooden bridge for damage. The afternoon group will repeat these steps with the same equipment so that our records stay consistent. Clear paragraphs help every reader find the original evidence without guessing what changed. We keep the complete account because small details often explain a surprising result during the next visit.'
);

const original = ['River garden field notebook', ...paragraphs].join('\n\n');

test.stable('Create edit and reopen a plain note', async ({ page, expectScreenshot }) => {
  await page.goto('/notes');
  test.expect(page.viewportSize()).toEqual({ width: 2560, height: 1440 });
  const composer = page.getByRole('textbox', { name: copy.NoteCompose });

  await composer.fill(original);
  await page.getByRole('button', { name: copy.NoteSaveNote }).click();
  await test.expect(page).toHaveURL(/\/notes\/.+/);
  const noteUrl = page.url();
  const notebook = page.getByRole('region', { name: copy.NoteNotebook });
  const body = notebook.locator('.chat-message-text');
  const entryLabel = notebook.getByText(copy.NoteEntryNote, { exact: true });

  await test.expect(body).toHaveText(original);
  await entryLabel.scrollIntoViewIfNeeded();
  await test.expect(entryLabel).toBeInViewport({ ratio: 1 });
  await expectScreenshot('saved-top', {
    target: 'viewport',
    ready: async () => {
      await test.expect(body).toHaveText(original);
      await test.expect(entryLabel).toBeInViewport({ ratio: 1 });
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

    await test.expect(editor).toHaveValue(content);
    content = content.replace(before!, after!);
    await editor.fill(content);

    if (before === 'Field observation 11.') {
      await editor.press('ControlOrMeta+a');
      await editor.press('ArrowLeft');

      // Move past observation 11 so its corrected paragraph is visible above the caret.
      for (let paragraph = 0; paragraph < 23; paragraph++) await editor.press('Control+ArrowDown');

      await test.expect(editor).toBeFocused();
      await test.expect(editor.locator(':scope:focus-visible')).toHaveCount(1);
      await editor.press('Tab');
      const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

      await test.expect(save).toBeFocused();
      await test.expect(save).toBeInViewport({ ratio: 1 });
      await test.expect(save).toHaveCSS('--tw-ring-inset', 'inset');
      await save.press('Shift+Tab');
      await test.expect(editor).toBeFocused();
      await expectScreenshot('editing-middle', {
        target: dialog,
        ready: async () => {
          await test.expect(editor).toHaveValue(content);
        }
      });
    }

    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await test.expect(dialog).toBeHidden();
    await test.expect(body).toHaveText(content);
    await page.goto('/projects');
    await test.expect(page).toHaveURL(/\/projects/);
    await page.goBack();
    await test.expect(page).toHaveURL(noteUrl);
    await test.expect(body).toHaveText(content);
  }

  await page.reload();
  await test.expect(body).toHaveText(content);
  await test.expect(notebook.locator('[data-role="assistant"]')).toHaveCount(0);
  await test.expect(notebook.locator('[data-role="user"]')).toHaveCount(1);
  const scrollHost = page.locator('[data-notebook-scroll-host]');

  await entryLabel.scrollIntoViewIfNeeded();
  await test.expect(entryLabel).toBeInViewport({ ratio: 1 });
  await scrollHost.click();
  await test.expect(scrollHost.locator(':scope:focus-visible')).toHaveCount(0);
  await test.expect(scrollHost).toHaveCSS('outline-style', 'none');
  await scrollHost.press('End');
  await test.expect(entryLabel).not.toBeInViewport();
  await test.expect(body).toBeInViewport();
  await test.expect(composer).toBeInViewport({ ratio: 1 });
  await test
    .expect(page.getByRole('button', { name: copy.NoteSaveNote }))
    .toBeInViewport({ ratio: 1 });
  await test.expect
    .poll(async () => {
      const bodyBox = await body.boundingBox();
      const composerBox = await page.locator('.workspace-desk-floating-composer').boundingBox();

      return !!bodyBox && !!composerBox && bodyBox.y + bodyBox.height <= composerBox.y;
    })
    .toBe(true);
  await test.expect(scrollHost).toBeFocused();
  await test.expect(scrollHost.locator(':scope:focus-visible')).toHaveCount(1);
  await test.expect(scrollHost).toHaveCSS('outline-style', 'solid');
  await test.expect(scrollHost).not.toHaveCSS('outline-width', '0px');
  await expectScreenshot('reopened-bottom', {
    target: 'viewport',
    ready: async () => {
      await test.expect(body).toHaveText(content);
    }
  });
  await composer.click();
  await composer.press('ArrowLeft');
  await test.expect(composer).toBeFocused();
  await notebook.locator('[data-role="user"]').hover();
  await page.getByRole('button', { name: copy.NoteEditNote }).scrollIntoViewIfNeeded();
  await test
    .expect(page.getByRole('button', { name: copy.NoteEditNote }))
    .toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: copy.NoteEditNote }).click();
  await test
    .expect(page.getByRole('dialog', { name: copy.NoteEditNote }).getByRole('textbox'))
    .toHaveValue(content);
  await page.goto('/notes');
  await test
    .expect(
      page.getByRole('navigation', { name: copy.Notes, exact: true }).locator('a[href^="/notes/"]')
    )
    .toHaveCount(1);
  await test.expect(page.locator('a[href="' + new URL(noteUrl).pathname + '"]')).toHaveCount(1);
});
