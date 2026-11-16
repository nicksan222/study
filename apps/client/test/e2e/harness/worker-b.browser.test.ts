import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.stable(
  'another test file has fresh browser storage and SQLite rows',
  async ({ page, expect }) => {
    await page.goto('/notes');
    await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
    await expect(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
  }
);
