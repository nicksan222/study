import { test } from '@study/testing';

test.stable(
  'leaves the practice workspace empty for selection from the sidebar',
  async ({ page, expect, screen }) => {
    await page.open('/practice');
    expect(await screen.findByRole('main')).toHaveTextContent(/^$/);
    expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
  }
);
