import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Empty note drafts recover without creating notebooks',
  async ({ page, expectScreenshot, placeCaretAtEnd, expect }) => {
    const starter = page.getByRole('textbox', { name: copy.NoteCompose });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });
    const noteLinks = page
      .getByRole('navigation', { name: copy.Notes })
      .locator('a[href^="/notes/"]');
    const autosaved = page.getByRole('status').filter({ hasText: copy.NoteAutosaved });
    const content = [
      'Recovered field observations',
      ...Array.from(
        { length: 24 },
        (_, index) =>
          `Observation ${index + 1}: record the river level before comparing the daily measurements.\nKeep the original reading so the next survey can explain any change.`
      ),
      'Final observation: the corrected draft is complete.'
    ].join('\n\n');

    await page.goto('/notes');
    await expect(starter).toBeVisible();
    await expect(starter).toHaveText('');
    await page.clock.fastForward(1000);
    await expect(page).toHaveURL(/\/notes$/);
    await expect(noteLinks).toHaveCount(0);
    await expectScreenshot('empty-validation', {
      target: 'viewport',
      ready: () => expect(starter).toHaveText('')
    });

    await starter.click();
    await page.keyboard.insertText('   ');
    await expect(starter).toHaveText(/^\s+$/, { useInnerText: true });
    await page.clock.fastForward(1000);
    await expect(page).toHaveURL(/\/notes$/);
    await expect(noteLinks).toHaveCount(0);
    await expectScreenshot('whitespace-validation', {
      target: 'viewport',
      ready: () => expect(starter).toHaveText(/^\s+$/, { useInnerText: true })
    });

    await starter.fill(content);
    await page.clock.fastForward(1000);
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    const identity = page.url();
    const first = editor.getByText(content.split('\n')[0]!, { exact: true });
    const last = editor.getByText('Final observation: the corrected draft is complete!', {
      exact: true
    });

    await expect(editor).toHaveText(content, { useInnerText: true });
    await expect(editor).toBeFocused();
    await expect(noteLinks).toHaveCount(1);
    await placeCaretAtEnd(editor);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('!');
    const corrected = content.replace(/\.$/, '!');

    await expect(last).toBeInViewport();
    await expect(first).not.toBeInViewport();
    await expect(editor).toHaveText(corrected, { useInnerText: true });
    await page.clock.fastForward(1000);
    await expectScreenshot('corrected-saved', {
      target: 'viewport',
      ready: async () => {
        await expect(autosaved).toBeVisible();
        await expect(last).toBeInViewport();
      }
    });

    await page.goto('/notes');
    await page.reload();
    await expect(noteLinks).toHaveCount(1);
    await noteLinks.click();
    await expect(page).toHaveURL(identity);
    await expect(editor).toHaveText(corrected, { useInnerText: true });
    await expect(first).toBeInViewport();
    await expect(last).not.toBeInViewport();
  }
);
