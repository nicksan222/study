import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { LibraryListView } from './library-list.view';

test.stable('renders loading and empty states from props', async () => {
  test.renderInRouter(
    <LibraryListView
      state={{ status: 'pending' }}
      subjects={[]}
      blocked={false}
      query=""
      search={{}}
      reload={() => {}}
    />
  );
  test
    .expect(await test.screen.findByRole('status'))
    .toHaveTextContent(catalogs.english.LoadingStudy);
});

test.stable(
  'retries a failed load through its callback without executing transport work',
  async () => {
    const reload = test.vi.fn();
    const user = test.userEvent.setup();

    test.renderInRouter(
      <LibraryListView
        state={{ status: 'error', error: new StudyError('transient', 'offline') }}
        subjects={[]}
        blocked={false}
        query=""
        search={{}}
        reload={reload}
      />
    );
    await user.click(
      await test.screen.findByRole('button', { name: catalogs.english.StudyLoadError })
    );
    test.expect(reload).toHaveBeenCalledOnce();
  }
);

test.stable(
  'replaces its loading announcement with the empty practice list after a completed load',
  () => {
    const props = {
      subjects: [],
      blocked: false,
      query: '',
      search: {},
      reload: () => {}
    };
    const { rerender } = test.render(<LibraryListView {...props} state={{ status: 'pending' }} />);

    test.expect(test.screen.getByRole('status')).toHaveTextContent(catalogs.english.LoadingStudy);
    rerender(<LibraryListView {...props} state={{ status: 'success', data: [] }} />);
    test.expect(test.screen.queryByRole('status')).not.toBeInTheDocument();
    test.expect(test.screen.getByText(catalogs.english.SidebarPracticeEmpty)).toBeInTheDocument();
  }
);
