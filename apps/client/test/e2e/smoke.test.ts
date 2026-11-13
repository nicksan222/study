import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

testE2e('Notes preserve multiple edits after reopening', async ({ page, expectScreenshot }) => {
  const content = Array.from(
    { length: 24 },
    (_, i) =>
      `Paragraph ${i + 1}: a durable notebook entry with enough text to exercise scrolling and editing.`
  ).join('\n\n');

  await page.goto('/notes');
  await page.getByRole('textbox', { name: copy.NoteCompose }).fill(content);
  await page.getByRole('button', { name: copy.NoteSaveNote }).click();
  await expect(page).toHaveURL(/\/notes\/.+/);
  await page.getByRole('button', { name: copy.NoteEditNote }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
  const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

  await editor.fill(`${content}\n\nAn edited note`);
  await editor.press('ControlOrMeta+End');
  await expectScreenshot('editing', {
    target: dialog,
    ready: async () => {
      await expect(editor).toHaveValue(`${content}\n\nAn edited note`);
      await expect(editor).toBeFocused();
      await expect(editor).toHaveJSProperty(
        'selectionStart',
        `${content}\n\nAn edited note`.length
      );
      await expect(editor).toHaveJSProperty('selectionEnd', `${content}\n\nAn edited note`.length);
    }
  });
  await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: copy.NoteNotebook })).toContainText(
    'An edited note'
  );
  await page.reload();
  await expect(page.getByRole('region', { name: copy.NoteNotebook })).toContainText(
    'An edited note'
  );
  await page.getByRole('button', { name: copy.NoteEditNote }).focus();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue(`${content}\n\nAn edited note`);
  await editor.fill('A second edit after reopening');
  await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: copy.NoteNotebook })).toContainText(
    'A second edit after reopening'
  );
  await page.reload();
  await expectScreenshot('reopened', {
    target: 'viewport',
    ready: () =>
      expect(page.getByRole('region', { name: copy.NoteNotebook })).toContainText(
        'A second edit after reopening'
      )
  });
});
