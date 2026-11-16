import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens Assistant as a full page in %s',
  async (locale, { page, expect, screen }) => {
    await page.open('/assistant', { locale });
    const copy = catalogs[locale];

    expect(await screen.findByRole('heading', { name: copy.Assistant })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.Assistant })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('log', { name: copy.Assistant })).toHaveAttribute(
      'data-slot',
      'message-scroller-content'
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

test.stable(
  'keeps Assistant drafts across page navigation',
  async ({ page, userEvent, screen, waitFor, expect, act }) => {
    const { router } = await page.open('/assistant');
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'Keep this draft');
    await act(() => router.navigate({ to: '/notes' }));
    await user.click(await screen.findByRole('link', { name: 'Assistant' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
    expect(router.state.location.pathname).toBe('/assistant');
  }
);
