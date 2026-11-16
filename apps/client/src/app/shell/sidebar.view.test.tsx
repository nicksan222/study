import { defaultWorkspacePreferences } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import type * as __StudyMockType1 from '#client/app/shell/sidebar.view.tsx';
import type * as __StudyMockType0 from '#client/test/sidebar-model.ts';

let sidebarModel: typeof __StudyMockType0.sidebarModel;

let SidebarView: typeof __StudyMockType1.SidebarView;

test.beforeEach(async ({ mock }) => {
  mock('#client/app/shell/rich-sidebar.queries.ts', () => ({
    useSidebarProgress: () => ({
      settings: { data: { settledPageThreshold: 1 } },
      progress: { data: { items: [] } }
    }),
    useNoteSettlement: () => ({ mutate: mock.fn(), isPending: false })
  }));
  const __studyMockModule0 = await import('#client/test/sidebar-model.ts');

  sidebarModel = __studyMockModule0.sidebarModel;
  const __studyMockModule1 = await import('./sidebar.view');

  SidebarView = __studyMockModule1.SidebarView;
});

function renderSidebar(children: ReactNode) {
  const fixture = test.rpcTestTransport(async () => defaultWorkspacePreferences);

  return test.renderInRouter(<fixture.wrapper>{children}</fixture.wrapper>);
}

test.stable(
  'renders invalid subjects and invokes retry callbacks without fetching data',
  async () => {
    const user = test.userEvent.setup();
    const reloadSubjects = test.vi.fn();
    const fetch = test.vi.spyOn(globalThis, 'fetch');

    renderSidebar(
      <SidebarView
        {...sidebarModel()}
        invalidSubject
        subjectState="error"
        reloadSubjects={reloadSubjects}
        collection={null}
      />
    );
    test.expect(await test.screen.findByText(catalogs.english.SubjectNotFound)).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: catalogs.english.SubjectsLoadError }));
    test.expect(reloadSubjects).toHaveBeenCalledOnce();
    test.expect(fetch).not.toHaveBeenCalled();
  }
);

test.stable('allows creating an unfiled note from an empty note list', async () => {
  const user = test.userEvent.setup();
  const createNote = test.vi.fn();

  renderSidebar(<SidebarView {...sidebarModel()} createNote={createNote} collection={null} />);
  test.expect(await test.screen.findByText(catalogs.english.DashboardNoNotes)).toBeInTheDocument();
  const create = test.screen.getByRole('button', { name: catalogs.english.NewNote });

  test.expect(create).toBeEnabled();
  await user.click(create);
  test.expect(createNote).toHaveBeenCalledOnce();
});

test.stable('announces note loading once through the shared indicator', async () => {
  renderSidebar(<SidebarView {...sidebarModel()} noteState="loading" collection={null} />);

  test
    .expect(await test.screen.findByRole('status'))
    .toHaveTextContent(catalogs.english.LoadingNotes);
  test.expect(test.screen.getAllByRole('status')).toHaveLength(1);
});

test.stable('shows the shared search indicator while search results are pending', async () => {
  renderSidebar(<SidebarView {...sidebarModel()} query="biology" collection={null} />);

  test.expect(await test.screen.findByRole('status')).toHaveTextContent(catalogs.english.Searching);
  test.expect(test.screen.getAllByRole('status')).toHaveLength(1);
});

test.stable('shows localized loading in the subject picker', async () => {
  renderSidebar(
    <SidebarView {...sidebarModel()} pickerOpen subjectState="loading" collection={null} />
  );

  test.expect(await test.screen.findByText(catalogs.english.LoadingSubjects)).toBeInTheDocument();
});

test.stable(
  'keeps a saving subject disabled with one loading announcement in the dialog',
  async () => {
    renderSidebar(
      <SidebarView {...sidebarModel()} newSubjectOpen creating name="Biology" collection={null} />
    );
    const dialog = await test.screen.findByRole('dialog');
    const saving = test.within(dialog).getByRole('button', { name: catalogs.english.Saving });

    test.expect(saving).toBeDisabled();
    test.expect(test.within(dialog).getAllByRole('status')).toHaveLength(1);
    test.expect(test.within(dialog).getByRole('status')).toHaveTextContent(catalogs.english.Saving);
  }
);

test.stable('offers page creation instead of note creation in Pages', async () => {
  renderSidebar(
    <SidebarView
      {...sidebarModel()}
      metadata={{ title: 'SourcePage', section: 'pages', scope: 'project' }}
      section="pages"
      collection={null}
    />
  );

  test
    .expect(await test.screen.findByRole('button', { name: catalogs.english.NoteCreatePage }))
    .toBeEnabled();
  test
    .expect(test.screen.queryByRole('button', { name: catalogs.english.NewNote }))
    .not.toBeInTheDocument();
});

test.stable('does not offer note creation on unrelated pages', async () => {
  renderSidebar(
    <SidebarView
      {...sidebarModel()}
      metadata={{ title: 'Help', section: 'notes', scope: 'global' }}
      collection={null}
    />
  );

  await test.screen.findByRole('button', { name: catalogs.english.NewProject });
  test
    .expect(test.screen.queryByRole('button', { name: catalogs.english.NewNote }))
    .not.toBeInTheDocument();
});
