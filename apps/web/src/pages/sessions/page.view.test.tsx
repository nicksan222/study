import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'renders the actual Sessions route and notebook starter in %s',
  async (locale) => {
    const { router } = renderPage('/sessions?project=9007199254740993', locale);
    const copy = catalogs[locale];

    expect(await screen.findByRole('heading', { name: copy.Sessions })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: copy.SessionStartTitle })
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('button', { name: copy.SessionNew })
        .every((button) => !button.hasAttribute('disabled'))
    ).toBe(true);
    const main = within(screen.getByRole('main'));
    expect(main.queryByRole('textbox', { name: copy.SessionCompose })).toBeNull();
    fireEvent.click(main.getByRole('button', { name: copy.SessionStartWithNote }));
    expect(await main.findByRole('textbox', { name: copy.SessionCompose })).toBeVisible();
    expect(screen.getByText(copy.SessionStartDraftHelp)).toBeVisible();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
