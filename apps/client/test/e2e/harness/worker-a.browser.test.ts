import { catalogs } from '@study/localization';

import { expect, testHarness } from './index.ts';

const copy = catalogs.english;

testHarness(
  'one application fixture can save private browser and SQLite state',
  async ({ page }) => {
    await page.goto('/notes');
    await page.evaluate(() => localStorage.setItem('sentinel', 'private'));
    await page.context().addCookies([{ name: 'sentinel', value: 'private', url: page.url() }]);
    await page.getByRole('textbox', { name: copy.NoteCompose }).fill('Isolation sentinel');
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
  }
);

testHarness(
  'the next application fixture has fresh browser storage and SQLite rows',
  async ({ page }) => {
    await page.goto('/notes');
    await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'sentinel')).toBe(
      false
    );
    await expect(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
  }
);
