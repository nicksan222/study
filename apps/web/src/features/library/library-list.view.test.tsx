import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { renderInRouter } from '../../test/render-in-router';
import { LibraryListView } from './library-list.view';

it('renders loading and empty states from props', async () => {
  renderInRouter(
    <LibraryListView
      state={{ status: 'pending' }}
      section="library"
      subjects={[]}
      blocked={false}
      query=""
      filter="all"
      search={{}}
      reload={() => {}}
    />
  );
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LoadingStudy);
});

it('retries a failed load through its callback without executing transport work', async () => {
  const reload = vi.fn();
  const user = userEvent.setup();

  renderInRouter(
    <LibraryListView
      state={{ status: 'error', error: new StudyError('transient', 'offline') }}
      section="library"
      subjects={[]}
      blocked={false}
      query=""
      filter="all"
      search={{}}
      reload={reload}
    />
  );
  await user.click(await screen.findByRole('button', { name: catalogs.english.StudyLoadError }));
  expect(reload).toHaveBeenCalledOnce();
});

it('replaces its loading announcement with the empty library after a completed load', () => {
  const props = {
    section: 'library' as const,
    subjects: [],
    blocked: false,
    query: '',
    filter: 'all' as const,
    search: {},
    reload: () => {}
  };
  const { rerender } = render(<LibraryListView {...props} state={{ status: 'pending' }} />);

  expect(screen.getByRole('status')).toHaveTextContent(catalogs.english.LoadingStudy);
  rerender(<LibraryListView {...props} state={{ status: 'success', data: [] }} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText(catalogs.english.SidebarLibraryEmpty)).toBeInTheDocument();
});
