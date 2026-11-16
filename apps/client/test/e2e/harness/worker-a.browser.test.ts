import { catalogs } from '@study/localization';
import { test } from '@study/testing';

// Keep consecutive fixtures in one worker to verify cleanup between tests.
test.stable.describe.configure({ mode: 'default' });

const copy = catalogs.english;

test.stable(
  'one application fixture can save private browser and SQLite state',
  async ({ page }) => {
    await page.goto('/notes');
    await page.evaluate(() => localStorage.setItem('sentinel', 'private'));
    await page.context().addCookies([{ name: 'sentinel', value: 'private', url: page.url() }]);
    await page.getByRole('textbox', { name: copy.NoteCompose }).fill('Isolation sentinel');
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await test.expect(page).toHaveURL(/\/notes\/.+/);
  }
);

test.stable(
  'the next application fixture has fresh browser storage and SQLite rows',
  async ({ page }) => {
    await page.goto('/notes');
    await test.expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
    test.expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
    test
      .expect((await page.context().cookies()).some((cookie) => cookie.name === 'sentinel'))
      .toBe(false);
    await test.expect(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
  }
);
