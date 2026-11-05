import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { renderInRouter } from '#web/test/render-in-router.tsx';

import { SidebarNavigation } from './sidebar-navigation.view';

testStable(
  'builds typed section links retaining the selected project and invokes navigation callbacks',
  async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    renderInRouter(
      <SidebarNavigation
        section="documents"
        settings={false}
        project="9007199254740993"
        onNavigate={onNavigate}
      />
    );
    const documents = await screen.findByRole('link', { name: catalogs.english.SourceDocument });

    expect(documents).toHaveAttribute('href', '/documents?project=9007199254740993');
    expect(documents).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('link', { name: catalogs.english.SidebarLibrary })
    ).not.toBeInTheDocument();
    await user.click(documents);
    expect(onNavigate).toHaveBeenCalledOnce();
  }
);

testStable('shows section totals and emphasizes only the number for open work', async () => {
  renderInRouter(
    <SidebarNavigation
      section="documents"
      settings={false}
      project={null}
      counts={{
        sessions: { count: 12, unresolved: true },
        documents: { count: 34 },
        practice: { count: 0 }
      }}
      onNavigate={() => {}}
    />
  );
  const sessions = await screen.findByRole('link', { name: catalogs.english.Sessions });
  const documents = screen.getByRole('link', { name: catalogs.english.SourceDocument });
  const practice = screen.getByRole('link', { name: catalogs.english.Practice });

  expect(sessions).toHaveTextContent('12');
  expect(sessions.querySelector('[data-unresolved]')).toHaveTextContent('12');
  expect(sessions).not.toHaveAttribute('data-unresolved');
  expect(documents).toHaveTextContent('34');
  expect(documents.querySelector('[data-unresolved]')).toBeNull();
  expect(practice).toHaveTextContent('0');
});
