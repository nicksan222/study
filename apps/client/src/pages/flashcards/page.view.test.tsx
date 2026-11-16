import { test } from '@study/testing';

test.unit.stable(
  'leaves the practice workspace empty for selection from the sidebar',
  async ({ page, expect, screen }) => {
    await page.open('/flashcards');
    expect(await screen.findByRole('main')).toHaveTextContent(/^$/);
    expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
  }
);
