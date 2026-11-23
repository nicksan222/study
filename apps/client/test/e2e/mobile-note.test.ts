import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.browser.stable(
  'Touch notebook writing autosaves in a short viewport',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));

    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const original = 'River garden field notebook';
    const changed = original + '. Bridge inspection corrected on mobile.';

    await expect(page.getByRole('button', { name: copy.NoteActions })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.NoteSaveNote })).toHaveCount(0);
    await expectScreenshot('starter-writing', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(starter).toHaveText('')
    });
    await starter.tap();
    await page.keyboard.insertText(original);
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await editor.tap();
    await expect(editor).toBeFocused();
    await page.setViewportSize({ width: 320, height: 520 });
    await editor.fill(changed);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 320);
    await expectAccessibility('touch-note-editor');
    await expectScreenshot('short-viewport-editor', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    });
    await page.reload();
    await expect(editor).toHaveText(changed);
  }
);

test.browser.stable(
  'Phone notebook actions keep history and assistant available',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));

    const text = 'Keep the measurements beside the original observations.';
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({ initialMessage: { text } })
    );

    await page.goto('/notes/' + String(note.id));
    const context = page.getByRole('button', { name: copy.NoteActions, exact: true });
    const actions = page.getByRole('complementary', { name: copy.NoteContextPanel, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await expect(editor).toHaveText(text);
    await expect(context).toHaveAttribute('aria-expanded', 'false');
    await context.tap();
    await expect(actions.getByRole('region', { name: copy.NoteAttachments })).toHaveCount(0);
    await expectScreenshot('note-actions', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(actions.getByRole('button', { name: copy.NoteHistory })).toBeVisible()
    });
    await actions.getByRole('button', { name: copy.NoteHistory }).tap();
    const history = page.getByRole('region', { name: copy.NoteNotebook, exact: true });

    const backToEditor = page.getByRole('button', { name: copy.NoteBackToEditor, exact: true });

    await expect(history.getByText(text)).toBeVisible();
    await expect(context).toHaveAttribute('aria-expanded', 'false');
    await expect(backToEditor).toBeFocused();
    await backToEditor.tap();
    await page.getByRole('button', { name: copy.NoteAssistantOpen, exact: true }).tap();
    await expect(page.getByRole('button', { name: copy.NoteDockBelow })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.NoteDockBeside })).toHaveCount(0);
    const back = page.getByRole('button', { name: copy.NoteBackToBoard, exact: true });

    await expectScreenshot('assistant-panel', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(back).toBeVisible()
    });
    await back.tap();
    await expect(editor).toHaveText(text);
  }
);
