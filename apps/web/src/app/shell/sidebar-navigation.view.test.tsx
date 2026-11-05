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
