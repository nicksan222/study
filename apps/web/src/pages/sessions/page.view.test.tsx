import { catalogs } from '@study/localization';
import { screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';

import { renderPage } from '../../test/render-page';

it.each(['english', 'italian'] as const)(
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
    expect(await screen.findByRole('textbox', { name: copy.SessionCompose })).toBeVisible();
    expect(screen.getByText(copy.SessionStartDraftHelp)).toBeVisible();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
