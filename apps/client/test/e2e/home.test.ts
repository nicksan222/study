import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

testE2e('Home navigation reaches Projects', async ({ page, expectScreenshot }) => {
  await page.goto('/home');
  await expect(page).toHaveURL(/\/notes$/);
  await page.getByRole('combobox', { name: copy.ChooseProject }).click();
  await page.getByRole('link', { name: copy.Projects, exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expectScreenshot('projects', {
    target: 'viewport',
    ready: () => expect(page.getByRole('heading', { name: copy.Projects })).toBeVisible()
  });
});
