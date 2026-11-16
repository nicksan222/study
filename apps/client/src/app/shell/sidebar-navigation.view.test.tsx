import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { SidebarNavigation } from './sidebar-navigation.view';

test.stable(
  'builds typed section links retaining the selected project and invokes navigation callbacks',
  async () => {
    const onNavigate = test.vi.fn();
    const user = test.userEvent.setup();

    test.renderInRouter(
      <SidebarNavigation
        section="pages"
        settings={false}
        project="9007199254740993"
        onNavigate={onNavigate}
      />
    );
    const pages = await test.screen.findByRole('link', { name: catalogs.english.SourcePage });

    test.expect(pages).toHaveAttribute('href', '/pages?project=9007199254740993');
    test.expect(pages).toHaveAttribute('aria-current', 'page');
    test
      .expect(test.screen.queryByRole('link', { name: catalogs.english.SidebarLibrary }))
      .not.toBeInTheDocument();
    await user.click(pages);
    test.expect(onNavigate).toHaveBeenCalledOnce();
  }
);

test.stable('shows section totals and emphasizes only the number for open work', async () => {
  test.renderInRouter(
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
  const notes = await test.screen.findByRole('link', { name: `${catalogs.english.Notes} 12` });
  const pages = test.screen.getByRole('link', { name: `${catalogs.english.SourcePage} 34` });
  const practice = test.screen.getByRole('link', { name: `${catalogs.english.Practice} 0` });

  test.expect(notes).toHaveTextContent('12');
  test.expect(notes.querySelector('[data-unresolved]')).toHaveTextContent('12');
  test.expect(notes).not.toHaveAttribute('data-unresolved');
  test.expect(pages).toHaveTextContent('34');
  test.expect(pages.querySelector('[data-unresolved]')).toBeNull();
  test.expect(practice).toHaveTextContent('0');
});
