import { catalogs } from '@study/localization';
import { expect } from 'vite-plus/test';

import { expect as expectWeb, testHarness } from './index.ts';

const copy = catalogs.english;

testHarness(
  'worker first file closes context and real application after a body failure',
  async ({ withWebE2e }) => {
    await expect(
      withWebE2e('isolation-body-failure', async ({ page }) => {
        await page.goto('/notes');
        await page.evaluate(() => localStorage.setItem('sentinel', 'private'));
        await page.context().addCookies([{ name: 'sentinel', value: 'private', url: page.url() }]);
        await page.getByRole('textbox', { name: copy.NoteCompose }).fill('Isolation sentinel');
        await page.getByRole('button', { name: copy.NoteSaveNote }).click();
        await page.waitForURL(/\/notes\/.+/);

        throw new Error('deliberate body failure');
      })
    ).rejects.toMatchObject({ errors: [new Error('deliberate body failure')] });
    await expect(
      withWebE2e('isolation-after-failure', async ({ page }) => {
        await page.goto('/notes');
        await expectWeb(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
        expect((await page.context().cookies()).some((cookie) => cookie.name === 'sentinel')).toBe(
          false
        );
        await expectWeb(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
      })
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringContaining('screenshot') })]
    });
  }
);
