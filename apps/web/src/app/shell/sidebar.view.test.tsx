import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { renderInRouter } from '#web/test/render-in-router.tsx';
import { sidebarModel } from '#web/test/sidebar-model.ts';

import { SidebarView } from './sidebar.view';

const caches: QueryClient[] = [];

afterEach(() => {
  caches.splice(0).forEach((cache) => cache.clear());
});

function renderSidebar(children: ReactNode) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);

  return renderInRouter(<QueryClientProvider client={cache}>{children}</QueryClientProvider>);
}

vi.mock('./rich-sidebar.queries', () => ({
  useSidebarProgress: () => ({
    settings: { data: { settledDocumentThreshold: 1 } },
    progress: { data: { items: [] } }
  }),
  useSessionSettlement: () => ({ mutate: vi.fn(), isPending: false })
}));

testStable(
  'renders invalid subjects and invokes retry callbacks without fetching data',
  async () => {
    const user = userEvent.setup();
    const reloadSubjects = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch');

    renderSidebar(
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
  }
);

testStable('allows creating an unfiled session from an empty session list', async () => {
  const user = userEvent.setup();
  const createSession = vi.fn();

  renderSidebar(<SidebarView {...sidebarModel()} createSession={createSession} library={null} />);
  expect(await screen.findByText(catalogs.english.DashboardNoSessions)).toBeInTheDocument();
  const create = screen.getByRole('button', { name: catalogs.english.NewSession });

  expect(create).toBeEnabled();
  await user.click(create);
  expect(createSession).toHaveBeenCalledOnce();
});

testStable('announces session loading once through the shared indicator', async () => {
  renderSidebar(<SidebarView {...sidebarModel()} sessionState="loading" library={null} />);

  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LoadingSessions);
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

testStable('shows the shared search indicator while search results are pending', async () => {
  renderSidebar(<SidebarView {...sidebarModel()} query="biology" library={null} />);

  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.Searching);
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

testStable('shows localized loading in the subject picker', async () => {
  renderSidebar(
    <SidebarView {...sidebarModel()} pickerOpen subjectState="loading" library={null} />
  );

  expect(await screen.findByText(catalogs.english.LoadingSubjects)).toBeInTheDocument();
});

testStable(
  'keeps a saving subject disabled with one loading announcement in the dialog',
  async () => {
    renderSidebar(
      <SidebarView {...sidebarModel()} newSubjectOpen creating name="Biology" library={null} />
    );
    const dialog = await screen.findByRole('dialog');
    const saving = within(dialog).getByRole('button', { name: catalogs.english.Saving });

    expect(saving).toBeDisabled();
    expect(within(dialog).getAllByRole('status')).toHaveLength(1);
    expect(within(dialog).getByRole('status')).toHaveTextContent(catalogs.english.Saving);
  }
);
