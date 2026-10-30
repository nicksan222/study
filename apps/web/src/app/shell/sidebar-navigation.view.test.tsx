import { catalogs } from '@study/localization';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { renderInRouter } from '../../test/render-in-router';
import { SidebarNavigation } from './sidebar-navigation.view';

it('builds typed section links retaining the selected project and invokes navigation callbacks', async () => {
  const onNavigate = vi.fn();
  const user = userEvent.setup();

  renderInRouter(
    <SidebarNavigation
      section="library"
      settings={false}
      project="9007199254740993"
      onNavigate={onNavigate}
    />
  );
  const library = await screen.findByRole('link', { name: catalogs.english.SidebarLibrary });

  expect(library).toHaveAttribute('href', '/MediaList?project=9007199254740993');
  expect(library).toHaveAttribute('aria-current', 'page');
  await user.click(library);
  expect(onNavigate).toHaveBeenCalledOnce();
});
