import { catalogs } from '@study/localization';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { renderInRouter } from '../../test/render-in-router';
import { sidebarModel } from '../../test/sidebar-model';
import { SidebarView } from './sidebar.view';

it('renders invalid subjects and invokes retry callbacks without fetching data', async () => {
  const user = userEvent.setup();
  const reloadSubjects = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch');

  renderInRouter(
    <SidebarView
      {...sidebarModel()}
      invalidSubject
      subjectState="error"
      reloadSubjects={reloadSubjects}
      library={null}
    />
  );
  expect(await screen.findByText(catalogs.english.SubjectNotFound)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: catalogs.english.SubjectsLoadError }));
  expect(reloadSubjects).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

it('shows an empty session list and blocks creation without a selected project', async () => {
  renderInRouter(<SidebarView {...sidebarModel()} library={null} />);
  expect(await screen.findByText(catalogs.english.DashboardNoSessions)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: catalogs.english.NewSession })).toBeDisabled();
});
