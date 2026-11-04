import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'preserves the exact selected project on all three Home links in %s',
  async (locale) => {
    renderPage('/home?project=9007199254740993', locale);
    const t = catalogs[locale];
    const navigation = within(await screen.findByRole('navigation', { name: t.Home }));
    const links = navigation.getAllByRole('link');

    expect(links).toHaveLength(3);
    expect(navigation.getByRole('link', { name: new RegExp(t.Sessions) })).toHaveAttribute(
      'href',
      '/sessions?project=9007199254740993'
    );
    expect(
      navigation.getByRole('link', { name: new RegExp(t['collections.library']) })
    ).toHaveAttribute('href', '/library?project=9007199254740993');
    expect(navigation.getByRole('link', { name: new RegExp(t.Projects) })).toHaveAttribute(
      'href',
      '/projects?project=9007199254740993'
    );
  }
);

testStable('offers unscoped links when no project is selected', async () => {
  renderPage('/home', 'english');
  const navigation = within(await screen.findByRole('navigation', { name: catalogs.english.Home }));

  expect(navigation.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '/sessions',
    '/library',
    '/projects'
  ]);
});
