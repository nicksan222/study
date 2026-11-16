import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { LibraryListView } from './library-list.view';

test.unit.stable(
  'renders loading and empty states from props',
  async ({ renderInRouter, expect, screen }) => {
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
  }
);

test.unit.stable(
  'retries a failed load through its callback without executing transport work',
  async ({ vi, userEvent, renderInRouter, screen, expect }) => {
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

test.unit.stable(
  'replaces its loading announcement with the empty practice list after a completed load',
  ({ render, expect, screen }) => {
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
