import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.stable(
  'Home navigation reaches Projects',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/home');
    await test.expect(page).toHaveURL(/\/notes$/);
    await page.getByRole('combobox', { name: copy.ChooseProject }).click();
    await page.getByRole('link', { name: copy.Projects, exact: true }).click();
    await test.expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('heading', { name: copy.Projects }).hover();
    await test.expect(page.getByRole('heading', { name: copy.Projects })).toBeVisible();
    await expectAccessibility('projects');
    await expectScreenshot('projects', {
      target: 'viewport',
      ready: () => test.expect(page.getByRole('heading', { name: copy.Projects })).toBeVisible()
    });
  }
);
