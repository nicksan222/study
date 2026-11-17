import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.browser.stable(
  'Touch note editing keeps entry drafts and save reachable',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    const original =
      'River garden field notebook\n\nMorning survey: record the water level and inspect the wooden bridge.\n\nKeep the original observations so the next team can compare the results.';
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: original, sourceIds: [] }
      })
    );

    await page.goto('/notes/' + String(note.id));
    await page.getByRole('button', { name: copy.ToggleSidebar }).tap();
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const edit = page.getByRole('button', { name: copy.NoteEditNote });

    await expect(edit).toBeInViewport({ ratio: 1 });
    await edit.tap();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });
    const changed = original + '\n\nBridge inspection corrected on mobile.';

    await expect(editor).toHaveValue(original);
    await editor.fill(changed);
    await dialog.getByRole('button', { name: copy.NoteBackToNotebook }).tap();
    await expect(dialog).toBeHidden();
    await expect(notebook.locator('.chat-message-text')).toHaveText(original);
    const resume = page.getByRole('button', { name: copy.NoteContinueEditing });

    await resume.scrollIntoViewIfNeeded();
    await expect(resume).toBeInViewport({ ratio: 1 });
    await expectScreenshot('paused-draft', {
      target: 'viewport',
      scrollToEnd: page.locator('[data-notebook-scroll-host]'),
      ready: () => expect(resume).toBeVisible()
    });
    await resume.tap();
    await expect(editor).toHaveValue(changed);
    await page.setViewportSize({ width: 390, height: 520 });
    await expect(dialog).toHaveCSS('translate', '0px');
    const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

    await expect(save).toBeInViewport({ ratio: 1 });
    await expectAccessibility('touch-note-editor');
    await expectScreenshot('short-viewport-editor', {
      target: 'viewport',
      ready: () => expect(editor).toHaveValue(changed)
    });
    await save.tap();
    await expect(dialog).toBeHidden();
    await expect(notebook.locator('.chat-message-text')).toHaveText(changed);
    await page.reload();
    await expect(notebook.locator('.chat-message-text')).toHaveText(changed);
  }
);
