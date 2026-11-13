import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

testE2e('Closing Settings preserves the underlying route', async ({ page, expectScreenshot }) => {
  await page.goto('/notes');
  await page.getByRole('button', { name: copy.Settings, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.Settings });

  await expectScreenshot('settings', { target: dialog, ready: () => expect(dialog).toBeVisible() });
  await dialog.getByRole('button', { name: copy.Close }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/notes$/);
  await expectScreenshot('closed', {
    target: 'viewport',
    ready: () => expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible()
  });
});
