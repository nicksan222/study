import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Empty edits pause and discard without replacing the saved note',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    const original = 'River survey\n\nRetain the original water level measurements.';
    const corrected = original + '\n\nThe bridge gauge was recalibrated.';
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: original, sourceIds: [] }
      })
    );

    await page.goto('/notes/' + String(note.id));
    const entry = page.locator('[data-role="user"]');
    const body = entry.locator('.chat-message-text');
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });
    const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

    await entry.hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    await expect(editor).toBeFocused();
    await expectScreenshot('unchanged-editor', {
      target: dialog,
      ready: () => expect(dialog.getByRole('status')).toHaveText(copy.NoteEditUnchanged)
    });
    await editor.fill('');
    await expect(save).toBeDisabled();
    await expectScreenshot('empty-edit', {
      target: dialog,
      ready: () => expect(editor).toHaveValue('')
    });
    await editor.press('ControlOrMeta+Enter');
    await expect(dialog).toBeVisible();
    await editor.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(body).toHaveText(original);
    const resume = page.getByRole('button', { name: copy.NoteContinueEditing });

    await expect(resume).toBeVisible();
    await expectScreenshot('empty-draft-paused', {
      target: 'viewport',
      ready: () => expect(resume).toBeVisible()
    });
    await resume.click();
    await expect(editor).toHaveValue('');
    await expect(editor).toBeFocused();
    await editor.fill('   \n   ');
    await expect(save).toBeDisabled();
    await editor.press('ControlOrMeta+Enter');
    await expect(dialog).toBeVisible();
    await expectScreenshot('whitespace-edit', {
      target: dialog,
      ready: () => expect(save).toBeDisabled()
    });
    await editor.fill(corrected);
    await expect(save).toBeEnabled();
    await expectScreenshot('corrected-unsaved', {
      target: dialog,
      ready: () => expect(dialog.getByRole('status')).toHaveText(copy.NoteEditUnsaved)
    });
    await dialog.getByRole('button', { name: copy.NoteDiscardEdits }).click();
    await expect(dialog).toBeHidden();
    await expect(body).toHaveText(original);
    await expect(resume).toHaveCount(0);
    await entry.hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    await expect(editor).toHaveValue(original);
    await expectScreenshot('discard-restored-original', {
      target: dialog,
      ready: () => expect(dialog.getByRole('status')).toHaveText(copy.NoteEditUnchanged)
    });
    await editor.fill(corrected);
    await editor.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();
    await expect(body).toHaveText(corrected);
    await page.reload();
    await expect(body).toHaveText(corrected);
    await expect(entry).toHaveCount(1);
    await expect(resume).toHaveCount(0);
    await expectAccessibility('saved-correction');
    await expectScreenshot('correction-reloaded', {
      target: 'viewport',
      ready: () => expect(body).toHaveText(corrected)
    });
  }
);
