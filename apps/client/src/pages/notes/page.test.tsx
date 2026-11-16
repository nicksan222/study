import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens the Notes page in %s',
  async (locale, { page }) => {
    const { router } = await page.open('/notes?project=9007199254740993', { locale });

    test
      .expect(await test.screen.findByRole('heading', { name: catalogs[locale].Notes }))
      .toBeInTheDocument();
    test.expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
