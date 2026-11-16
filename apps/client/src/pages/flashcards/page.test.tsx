import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens the Flashcards page in %s',
  async (locale, { page }) => {
    const { router } = page.open('/flashcards?project=9007199254740993', { locale });

    test.expect(await test.screen.findByRole('main')).toHaveTextContent(/^$/);
    test.expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
