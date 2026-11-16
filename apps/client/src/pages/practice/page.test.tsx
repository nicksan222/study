import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens the Practice page in %s',
  async (locale, { page, expect, screen }) => {
    const { router } = await page.open('/practice?project=9007199254740993', { locale });

    expect(await screen.findByRole('main')).toHaveTextContent(/^$/);
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
