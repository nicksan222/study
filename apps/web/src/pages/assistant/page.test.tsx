import '#web/test/assistant.tsx';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'opens Assistant as a full page in %s',
  async (locale) => {
    renderPage('/assistant', locale);
    const copy = catalogs[locale];

    expect(await screen.findByRole('heading', { name: copy.Assistant })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.Assistant })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('log', { name: copy.Assistant })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

testStable('keeps Assistant drafts across page navigation', async () => {
  const { router } = renderPage('/assistant');
  const user = userEvent.setup();
  const input = await screen.findByRole('textbox', { name: 'Message' });

  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, 'Keep this draft');
  await act(() => router.navigate({ to: '/sessions' }));
  await user.click(await screen.findByRole('link', { name: 'Assistant' }));
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
  expect(router.state.location.pathname).toBe('/assistant');
});
