import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const paragraphs = Array.from(
  { length: 20 },
  (_, index) =>
    `Field observation ${index + 1}. ` +
    'The morning team walked beside the river and recorded the water level before opening the garden gates. Each observation belongs to this notebook and remains useful when we compare the seasons. We measured the shaded path, counted the young trees, and checked the wooden bridge for damage.'
);

const original = ['River garden field notebook', ...paragraphs].join('\n\n');

test.browser.stable(
  'Create edit and reopen a plain note',
  async ({ page, rpc, expectScreenshot, placeCaretAtEnd, expect }) => {
    const preferences = await rpc.runPromise(rpc.client['settings.workspacePreferences']({}));

    await rpc.runPromise(
      rpc.client['settings.saveWorkspacePreferences']({
        ...preferences,
        autosaveIntervalSeconds: 1
      })
    );

    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const status = page.getByRole('status').filter({ hasText: /^Saved$/ });

    await starter.fill(original);
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await expect(editor).toBeFocused();
    await expect(
      editor.locator('p').filter({ hasText: /Field observation|River garden field notebook/ })
    ).toHaveCount(paragraphs.length + 1);
    const noteUrl = page.url();
    const opening = editor.getByText('River garden field notebook', { exact: true });

    await opening.scrollIntoViewIfNeeded();
    await expectScreenshot('saved-top', {
      target: 'viewport',
      ready: () => expect(opening).toBeInViewport()
    });

    const changed = original
      .replace('Field observation 1.', 'Field observation 1: water level corrected.')
      .replace('Field observation 11.', 'Field observation 11: bridge inspection corrected.')
      .replace('Field observation 20.', 'Field observation 20: final count corrected.');

    await editor.fill(changed);
    await expect(editor).toBeFocused();
    await placeCaretAtEnd(editor.locator('p').last());
    await editor.press('Enter');
    await page.keyboard.insertText('Next visit');
    await editor.press('Shift+Enter');
    await page.keyboard.insertText('Verify the gauge calibration next visit.');
    await expect(editor.locator('p').last().locator('br')).toHaveCount(1);
    await expect(status).toBeVisible();
    await page.goto('/projects');
    await page.goto(noteUrl);
    await expect(editor).toContainText('water level corrected');
    await expect(editor).toContainText('bridge inspection corrected');
    const closing = editor.locator('p').last();

    await expect(closing).toHaveText('Next visitVerify the gauge calibration next visit.');
    await expect(closing.locator('br')).toHaveCount(1);
    await closing.scrollIntoViewIfNeeded();
    await expectScreenshot('reopened-hard-break', {
      target: closing,
      ready: () => expect(closing).toBeInViewport({ ratio: 1 })
    });
  }
);
