import { test } from '@study/testing';

test.unit.stable('shows study notes as a section of Practice', async ({ page, expect, screen }) => {
  await page.open('/practice');
  expect(await screen.findByRole('heading', { name: 'Study notes' })).toBeVisible();
  expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
});
