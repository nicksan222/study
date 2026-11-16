import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.stable('another test file has fresh browser storage and SQLite rows', async ({ page }) => {
  await page.goto('/notes');
  await test.expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
  test.expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
  await test.expect(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
});
