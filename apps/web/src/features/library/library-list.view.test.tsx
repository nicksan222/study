import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { renderInRouter } from '#web/test/render-in-router.tsx';

import { LibraryListView } from './library-list.view';

testStable('renders loading and empty states from props', async () => {
  renderInRouter(
    <LibraryListView
      state={{ status: 'pending' }}
      subjects={[]}
      blocked={false}
      query=""
      search={{}}
      reload={() => {}}
    />
  );
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LoadingStudy);
});

testStable(
  'retries a failed load through its callback without executing transport work',
  async () => {
    const reload = vi.fn();
    const user = userEvent.setup();

    renderInRouter(
      <LibraryListView
        state={{ status: 'error', error: new StudyError('transient', 'offline') }}
        subjects={[]}
        blocked={false}
        query=""
        search={{}}
        reload={reload}
      />
    );
    await user.click(await screen.findByRole('button', { name: catalogs.english.StudyLoadError }));
    expect(reload).toHaveBeenCalledOnce();
  }
);

testStable(
  'replaces its loading announcement with the empty practice list after a completed load',
  () => {
    const props = {
      subjects: [],
      blocked: false,
      query: '',
      search: {},
      reload: () => {}
    };
    const { rerender } = render(<LibraryListView {...props} state={{ status: 'pending' }} />);

    expect(screen.getByRole('status')).toHaveTextContent(catalogs.english.LoadingStudy);
    rerender(<LibraryListView {...props} state={{ status: 'success', data: [] }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(catalogs.english.SidebarPracticeEmpty)).toBeInTheDocument();
  }
);
