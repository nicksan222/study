import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { SidebarNavigation } from './sidebar-navigation.view';

test.unit.stable(
  'builds typed section links retaining the selected project and invokes navigation callbacks',
  async ({ vi, userEvent, renderInRouter, screen, expect }) => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    renderInRouter(
      <SidebarNavigation
        section="practice"
        settings={false}
        project="9007199254740993"
        onNavigate={onNavigate}
      />
    );
    const pages = await screen.findByRole('link', { name: catalogs.english.Practice });

    expect(pages).toHaveAttribute('href', '/practice?project=9007199254740993');
    expect(pages).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('link', { name: catalogs.english.SidebarLibrary })
    ).not.toBeInTheDocument();
    await user.click(pages);
    expect(onNavigate).toHaveBeenCalledOnce();
  }
);

test.unit.stable('shows section totals', async ({ renderInRouter, screen, expect }) => {
  renderInRouter(
    <SidebarNavigation
      section="practice"
      settings={false}
      project={null}
      counts={{
        notes: { count: 12 },
        practice: { count: 34 }
      }}
      onNavigate={() => {}}
    />
  );
  const notes = await screen.findByRole('link', { name: `${catalogs.english.Notes} 12` });
  const pages = screen.getByRole('link', { name: `${catalogs.english.Practice} 34` });

  expect(notes).toHaveTextContent('12');
  expect(pages).toHaveTextContent('34');
});
