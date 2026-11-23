import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Keyboard search expands the sidebar and recovers from no matches',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    const original = 'Willowbank survey\n\nMeasure the river beside the footbridge.';
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: original, sourceIds: [] }
      })
    );

    await page.goto('/notes');
    const search = page.getByRole('searchbox', { name: copy.Search, exact: true });
    const result = page.locator(`a[href="/notes/${String(note.id)}"]`);

    await expect(search).toBeVisible();
    await page.getByRole('button', { name: copy.ToggleSidebar }).click();
    await expect(search).toBeHidden();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await expectScreenshot('shortcut-expanded-sidebar', {
      target: 'viewport',
      focus: 'preserve',
      ready: () => expect(search).toBeFocused()
    });
    await search.fill('no-such-river-928');
    const empty = page.getByRole('status').filter({ hasText: copy.SearchNoResults });

    await expect(empty).toBeVisible();
    await expect(result).toHaveCount(0);
    await expectScreenshot('no-search-matches', {
      target: 'viewport',
      ready: () => expect(empty).toBeVisible()
    });
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(result).toBeVisible();
    await expectScreenshot('escape-restored-notes', {
      target: 'viewport',
      ready: () => expect(result).toBeVisible()
    });
    await search.fill('Willowbank');
    const match = result.filter({ hasText: 'Willowbank' });

    await expect(match).toHaveCount(1);
    await expect(empty).toHaveCount(0);
    await expectAccessibility('search-results');
    await expectScreenshot('matching-note', {
      target: 'viewport',
      ready: () => expect(match).toBeVisible()
    });
    await match.press('Enter');
    await expect(page).toHaveURL('/notes/' + String(note.id));
    await expect(search).toHaveValue('');
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const paragraphs = editor.locator('p');
    const expected = original.split('\n\n');

    await expect(paragraphs).toHaveText(expected);
    await expectScreenshot('result-opened', {
      target: 'viewport',
      ready: () => expect(paragraphs).toHaveText(expected)
    });
    await page.reload();
    await expect(paragraphs).toHaveText(expected);
    await expect(search).toHaveValue('');
    await expect(result).toHaveCount(1);
  }
);
