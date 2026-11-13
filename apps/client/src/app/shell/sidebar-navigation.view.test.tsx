import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { renderInRouter } from '#client/test/render-in-router.tsx';

import { SidebarNavigation } from './sidebar-navigation.view';

testStable(
  'builds typed section links retaining the selected project and invokes navigation callbacks',
  async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    renderInRouter(
      <SidebarNavigation
        section="pages"
        settings={false}
        project="9007199254740993"
        onNavigate={onNavigate}
      />
    );
    const pages = await screen.findByRole('link', { name: catalogs.english.SourcePage });

    expect(pages).toHaveAttribute('href', '/pages?project=9007199254740993');
    expect(pages).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('link', { name: catalogs.english.SidebarLibrary })
    ).not.toBeInTheDocument();
    await user.click(pages);
    expect(onNavigate).toHaveBeenCalledOnce();
  }
);

testStable('shows section totals and emphasizes only the number for open work', async () => {
  renderInRouter(
    <SidebarNavigation
      section="pages"
      settings={false}
      project={null}
      counts={{
        notes: { count: 12, unresolved: true },
        pages: { count: 34 },
        practice: { count: 0 }
      }}
      onNavigate={() => {}}
    />
  );
  const notes = await screen.findByRole('link', { name: catalogs.english.Notes });
  const pages = screen.getByRole('link', { name: catalogs.english.SourcePage });
  const practice = screen.getByRole('link', { name: catalogs.english.Practice });

  expect(notes).toHaveTextContent('12');
  expect(notes.querySelector('[data-unresolved]')).toHaveTextContent('12');
  expect(notes).not.toHaveAttribute('data-unresolved');
  expect(pages).toHaveTextContent('34');
  expect(pages.querySelector('[data-unresolved]')).toBeNull();
  expect(practice).toHaveTextContent('0');
});
