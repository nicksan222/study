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
        section="pages"
        settings={false}
        project="9007199254740993"
        onNavigate={onNavigate}
      />
    );
    const pages = await screen.findByRole('link', { name: catalogs.english.Documents });

    expect(pages).toHaveAttribute('href', '/notes?project=9007199254740993');
    expect(pages).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('link', { name: catalogs.english.SidebarLibrary })
    ).not.toBeInTheDocument();
    await user.click(pages);
    expect(onNavigate).toHaveBeenCalledOnce();
  }
);

test.unit.stable(
  'shows section totals and emphasizes only the number for open work',
  async ({ renderInRouter, screen, expect }) => {
    renderInRouter(
      <SidebarNavigation
        section="pages"
        settings={false}
        project={null}
        counts={{
          notes: { count: 12, unresolved: true },
          pages: { count: 34 },
          practice: { count: 0 }
        }}
        onNavigate={() => {}}
      />
    );
    const documents = await screen.findByRole('link', { name: `${catalogs.english.Documents} 46` });
    const practice = screen.getByRole('link', { name: `${catalogs.english.Practice} 0` });

    expect(documents.querySelector('[data-unresolved]')).toHaveTextContent('46');
    expect(documents).not.toHaveAttribute('data-unresolved');
    expect(practice).toHaveTextContent('0');
  }
);
