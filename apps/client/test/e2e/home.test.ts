import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { homeNavigation } from './home-navigation.ts';

const copy = catalogs.english;

test.browser.stable(
  'Home navigation reaches Projects',
  async ({ page, expectScreenshot, expectAccessibility, expect }) => {
    await homeNavigation({
      goto: (path) => page.goto(path),
      expectPath: (path) => expect(page).toHaveURL((url) => url.pathname === path),
      click: (role, name) => page.getByRole(role, { name, exact: true }).click(),
      expectHeading: (name) => expect(page.getByRole('heading', { name })).toBeVisible()
    });
    const heading = page.getByRole('heading', { name: copy.Projects });

    await heading.hover();
    await expectAccessibility('projects');
    await expectScreenshot('projects', {
      target: 'viewport',
      ready: () => expect(heading).toBeVisible()
    });
  }
);
