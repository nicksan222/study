import { catalogs } from '@study/localization';

import { expect, testHarness } from './index.ts';

const copy = catalogs.english;

testHarness('another test file has fresh browser storage and SQLite rows', async ({ page }) => {
  await page.goto('/notes');
  await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
  await expect(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
});
