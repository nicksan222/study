import { test } from '@study/testing';

test.stable(
  'leaves the practice workspace empty for selection from the sidebar',
  async ({ page }) => {
    await page.open('/practice');
    test.expect(await test.screen.findByRole('main')).toHaveTextContent(/^$/);
    test
      .expect(test.screen.getByRole('complementary', { name: 'Study navigation' }))
      .toBeInTheDocument();
  }
);
