import { catalogs } from '@study/localization';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { renderInRouter } from '../../test/render-in-router';
import { sidebarModel } from '../../test/sidebar-model';
import { SidebarView } from './sidebar.view';

vi.mock('./rich-sidebar.queries', () => ({
  useSidebarProgress: () => ({
    settings: { data: { settledDocumentThreshold: 1 } },
    progress: { data: { items: [] } }
  }),
  useSessionSettlement: () => ({ mutate: vi.fn(), isPending: false })
}));

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

it('allows creating an unfiled session from an empty session list', async () => {
  const user = userEvent.setup();
  const createSession = vi.fn();

  renderInRouter(<SidebarView {...sidebarModel()} createSession={createSession} library={null} />);
  expect(await screen.findByText(catalogs.english.DashboardNoSessions)).toBeInTheDocument();
  const create = screen.getByRole('button', { name: catalogs.english.NewSession });

  expect(create).toBeEnabled();
  await user.click(create);
  expect(createSession).toHaveBeenCalledOnce();
});

it('announces session loading once through the shared indicator', async () => {
  renderInRouter(<SidebarView {...sidebarModel()} sessionState="loading" library={null} />);

  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LoadingSessions);
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

it('shows the shared search indicator while search results are pending', async () => {
  renderInRouter(<SidebarView {...sidebarModel()} query="biology" library={null} />);

  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.Searching);
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

it('shows localized loading in the subject picker', async () => {
  renderInRouter(
    <SidebarView {...sidebarModel()} pickerOpen subjectState="loading" library={null} />
  );

  expect(await screen.findByText(catalogs.english.LoadingSubjects)).toBeInTheDocument();
});

it('keeps a saving subject disabled with one loading announcement in the dialog', async () => {
  renderInRouter(
    <SidebarView {...sidebarModel()} newSubjectOpen creating name="Biology" library={null} />
  );
  const dialog = await screen.findByRole('dialog');
  const saving = within(dialog).getByRole('button', { name: catalogs.english.Saving });

  expect(saving).toBeDisabled();
  expect(within(dialog).getAllByRole('status')).toHaveLength(1);
  expect(within(dialog).getByRole('status')).toHaveTextContent(catalogs.english.Saving);
});
