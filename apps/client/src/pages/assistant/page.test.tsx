import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens Assistant as a full page in %s',
  async (locale, { page }) => {
    await page.open('/assistant', { locale });
    const copy = catalogs[locale];

    test
      .expect(await test.screen.findByRole('heading', { name: copy.Assistant }))
      .toBeInTheDocument();
    test
      .expect(test.screen.getByRole('link', { name: copy.Assistant }))
      .toHaveAttribute('aria-current', 'page');
    test
      .expect(test.screen.getByRole('log', { name: copy.Assistant }))
      .toHaveAttribute('data-slot', 'message-scroller-content');
    test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

test.stable('keeps Assistant drafts across page navigation', async ({ page }) => {
  const { router } = await page.open('/assistant');
  const user = test.userEvent.setup();
  const input = await test.screen.findByRole('textbox', { name: 'Message' });

  await test.waitFor(() => test.expect(input).toBeEnabled());
  await user.type(input, 'Keep this draft');
  await test.act(() => router.navigate({ to: '/notes' }));
  await user.click(await test.screen.findByRole('link', { name: 'Assistant' }));
  test
    .expect(await test.screen.findByRole('textbox', { name: 'Message' }))
    .toHaveValue('Keep this draft');
  test.expect(router.state.location.pathname).toBe('/assistant');
});
