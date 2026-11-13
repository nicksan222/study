import { catalogs } from '@study/localization';
import { expect } from 'vite-plus/test';

import { expect as expectWeb, testHarness } from './index.ts';

const copy = catalogs.english;

testHarness(
  'worker second file has fresh browser storage and SQLite rows',
  async ({ withWebE2e }) => {
    await expect(
      withWebE2e('isolation-fresh-state', async ({ page }) => {
        await page.goto('/notes');
        await expectWeb(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
        await expectWeb(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
      })
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringContaining('screenshot') })]
    });

    const launches = [...new Bun.Glob(`test-results/workers/${process.pid}-*.json`).scanSync()];

    expect(launches).toHaveLength(1);
  }
);
