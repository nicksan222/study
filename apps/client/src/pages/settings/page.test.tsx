import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.unit.stable.for(['english', 'italian'] as const)(
  'opens the Settings page in %s',
  async (locale, { page, expect, screen }) => {
    const { router } = await page.open('/settings?project=9007199254740993', { locale });

    expect(
      await screen.findByRole('heading', { name: catalogs[locale].Settings })
    ).toBeInTheDocument();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
