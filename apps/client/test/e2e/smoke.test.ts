import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.stable('Notes preserve multiple edits after reopening', async ({ page, expectScreenshot }) => {
  const content = Array.from(
    { length: 24 },
    (_, i) =>
      `Paragraph ${i + 1}: a durable notebook entry with enough text to exercise scrolling and editing.`
  ).join('\n\n');

  await page.goto('/notes');
  await page.getByRole('textbox', { name: copy.NoteCompose }).fill(content);
  await page.getByRole('button', { name: copy.NoteSaveNote }).click();
  await test.expect(page).toHaveURL(/\/notes\/.+/);
  await page.getByRole('button', { name: copy.NoteEditNote }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
  const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

  // Native caret scrolling depends on the popup's final geometry at fractional app zoom.
  await test.expect(dialog).toHaveCSS('scale', '1');
  await editor.fill(`${content}\n\nAn edited note`);
  await editor.press('ControlOrMeta+End');
  await expectScreenshot('editing', {
    target: dialog,
    ready: async () => {
      await test.expect(editor).toHaveValue(`${content}\n\nAn edited note`);
      await test.expect(editor).toBeFocused();
      await test
        .expect(editor)
        .toHaveJSProperty('selectionStart', `${content}\n\nAn edited note`.length);
      await test
        .expect(editor)
        .toHaveJSProperty('selectionEnd', `${content}\n\nAn edited note`.length);
    }
  });
  await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
  await test.expect(dialog).toBeHidden();
  await test
    .expect(page.getByRole('region', { name: copy.NoteNotebook }))
    .toContainText('An edited note');
  await page.reload();
  await test
    .expect(page.getByRole('region', { name: copy.NoteNotebook }))
    .toContainText('An edited note');
  await page.getByRole('button', { name: copy.NoteEditNote }).focus();
  await page.keyboard.press('Enter');
  await test.expect(editor).toHaveValue(`${content}\n\nAn edited note`);
  await editor.fill('A second edit after reopening');
  await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
  await test.expect(dialog).toBeHidden();
  await test
    .expect(page.getByRole('region', { name: copy.NoteNotebook }))
    .toContainText('A second edit after reopening');
  await page.reload();
  await expectScreenshot('reopened', {
    target: 'viewport',
    ready: () =>
      test
        .expect(page.getByRole('region', { name: copy.NoteNotebook }))
        .toContainText('A second edit after reopening')
  });
});
