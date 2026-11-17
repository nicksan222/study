import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Long notes remain editable without content field sizing',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const original = Array.from(
      { length: 100 },
      (_, index) => `Observation ${index + 1}: retain the complete river survey and its evidence.`
    ).join('\n\n');
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: original, sourceIds: [] }
      })
    );

    await page.goto('/notes/' + String(note.id));
    await page.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    // Exercise the fallback layout in Chromium; this is not a native WebKit check.
    await page.addStyleTag({ content: '.notebook-editor-text { field-sizing: fixed; }' });
    await expect(editor).toHaveCSS('overflow-y', 'auto');
    await editor.press('ControlOrMeta+Home');
    await editor.press('PageDown');
    await expect(editor).not.toHaveJSProperty('scrollTop', 0);
    await editor.press('ControlOrMeta+End');
    await expect(editor).toHaveJSProperty('selectionStart', original.length);
    await expectScreenshot('last-observation', {
      target: dialog,
      ready: () => expect(editor).toHaveValue(original)
    });
    await editor.press('End');
    await editor.press('Space');
    await editor.press('x');
    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator('.chat-message-text')).toHaveText(original + ' x');
  }
);

test.browser.stable(
  'Rich note selection survives navigation before editing resumes',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const note = await rpc.runPromise(rpc.client['notes.createUntitledNote']({}));

    await rpc.runPromise(
      rpc.client['notes.postMessage']({
        noteId: note.id,
        format: 'document',
        requestReply: false,
        text: '# River garden\n\nKeep the complete survey evidence',
        sourceIds: []
      })
    );
    await page.goto('/notes/' + String(note.id));
    const card = page.locator('.workspace-desk-page').filter({ hasText: 'River garden' });

    await card.click();
    await page.getByRole('button', { name: copy.VersionHistory, exact: true }).click();
    const history = page.getByRole('dialog', { name: copy.VersionHistory });

    await expect(history.locator(':scope:focus-within')).toHaveCount(1);
    await history.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    await editor.press('ControlOrMeta+End');

    for (let character = 0; character < 8; character++) await editor.press('Shift+ArrowLeft');

    await dialog.getByRole('button', { name: copy.NoteBackToNotebook }).click();
    await expect(dialog).toBeHidden();
    await history.getByRole('button', { name: copy.Close, exact: true }).last().click();
    await page.getByRole('combobox', { name: copy.ChooseProject }).click();
    await page.getByRole('link', { name: copy.Projects, exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.goBack();
    await card.click();
    await page.getByRole('button', { name: copy.VersionHistory, exact: true }).click();
    await expect(history.locator(':scope:focus-within')).toHaveCount(1);
    await page.getByRole('button', { name: copy.NoteContinueEditing }).click();
    await expect(editor).toBeFocused();
    await expectScreenshot('resumed-selection', {
      target: dialog,
      focus: 'preserve',
      ready: () => expect(editor).toBeFocused()
    });
    await editor.pressSequentially('records');
    await expect(editor).toContainText('Keep the complete survey records');
    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(card).toContainText('Keep the complete survey records');
  }
);
