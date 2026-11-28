import { defaultWorkspacePreferences } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import { sidebarModel } from '#client/test/sidebar-model.ts';

import { SidebarView } from './sidebar.view';

function renderSidebar(
  {
    rpcTestTransport,
    renderInRouter
  }: Pick<test.unit.Context, 'rpcTestTransport' | 'renderInRouter'>,
  children: ReactNode
) {
  const fixture = rpcTestTransport(async (tag) =>
    tag === 'notes.noteSummaries' ? { items: [] } : defaultWorkspacePreferences
  );

  return renderInRouter(<fixture.wrapper>{children}</fixture.wrapper>);
}

test.unit.stable(
  'renders invalid subjects and invokes retry callbacks without fetching data',
  async ({ userEvent, vi, expect, screen, rpcTestTransport, renderInRouter }) => {
    const user = userEvent.setup();
    const reloadSubjects = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch');

    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView
        {...sidebarModel()}
        invalidSubject
        subjectState="error"
        reloadSubjects={reloadSubjects}
        collection={null}
      />
    );
    expect(await screen.findByText(catalogs.english.SubjectNotFound)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: catalogs.english.SubjectsLoadError }));
    expect(reloadSubjects).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'allows creating an unfiled note from an empty note list',
  async ({ userEvent, vi, expect, screen, rpcTestTransport, renderInRouter }) => {
    const user = userEvent.setup();
    const createNote = vi.fn();

    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView {...sidebarModel()} createNote={createNote} collection={null} />
    );
    expect(await screen.findByText(catalogs.english.DashboardNoNotes)).toBeInTheDocument();
    const create = screen.getByRole('button', { name: catalogs.english.NewNote });

    expect(create).toBeEnabled();
    await user.click(create);
    expect(createNote).toHaveBeenCalledOnce();
  }
);

test.unit.stable(
  'announces note loading once through the shared indicator',
  async ({ expect, screen, rpcTestTransport, renderInRouter }) => {
    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView {...sidebarModel()} noteState="loading" collection={null} />
    );

    expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LoadingNotes);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  }
);

test.unit.stable(
  'shows the shared search indicator while search results are pending',
  async ({ expect, screen, rpcTestTransport, renderInRouter }) => {
    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView {...sidebarModel()} query="biology" collection={null} />
    );

    expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.Searching);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  }
);

test.unit.stable(
  'shows localized loading in the subject picker',
  async ({ expect, screen, rpcTestTransport, renderInRouter }) => {
    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView {...sidebarModel()} pickerOpen subjectState="loading" collection={null} />
    );

    expect(await screen.findByText(catalogs.english.LoadingSubjects)).toBeInTheDocument();
  }
);

test.unit.stable(
  'keeps a saving subject disabled with one loading announcement in the dialog',
  async ({ screen, within, expect, rpcTestTransport, renderInRouter }) => {
    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView {...sidebarModel()} newSubjectOpen creating name="Biology" collection={null} />
    );
    const dialog = await screen.findByRole('dialog');
    const saving = within(dialog).getByRole('button', { name: catalogs.english.Saving });

    expect(saving).toBeDisabled();
    expect(within(dialog).getAllByRole('status')).toHaveLength(1);
    expect(within(dialog).getByRole('status')).toHaveTextContent(catalogs.english.Saving);
  }
);

test.unit.stable(
  'does not offer note creation on unrelated pages',
  async ({ screen, expect, rpcTestTransport, renderInRouter }) => {
    renderSidebar(
      { rpcTestTransport, renderInRouter },
      <SidebarView
        {...sidebarModel()}
        metadata={{ title: 'Help', section: 'notes', scope: 'global' }}
        collection={null}
      />
    );

    await screen.findByRole('button', { name: catalogs.english.NewProject });
    expect(
      screen.queryByRole('button', { name: catalogs.english.NewNote })
    ).not.toBeInTheDocument();
  }
);
