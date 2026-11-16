import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens the Practice page in %s',
  async (locale, { page }) => {
    const { router } = page.open('/practice?project=9007199254740993', { locale });

    test.expect(await test.screen.findByRole('main')).toHaveTextContent(/^$/);
    test.expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
