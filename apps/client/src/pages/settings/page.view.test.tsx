import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { PageView } from './page.view';

test.stable(
  'composes an appearance-only popup with accessible scheme and theme selection',
  async () => {
    const select = test.vi.fn();

    test.render(
      <PageView
        open
        onClose={test.vi.fn()}
        model={{
          data: {
            settings: { appearance: 2, language: 1, zoomPercent: 100, onboarded: true },
            preferences: { contrast: 100, glassOpacity: 80, animationDurationMs: 150 },
            selected: 'ocean',
            themes: [{ version: 1, id: 'ocean', name: 'Ocean', builtin: true }]
          },
          loading: false,
          error: false,
          pending: false,
          retry: test.vi.fn(),
          setPreferences: test.vi.fn(),
          setZoom: test.vi.fn(),
          setAppearance: select,
          selectTheme: test.vi.fn(),
          importTheme: test.vi.fn(),
          saveTheme: test.vi.fn(),
          deleteTheme: test.vi.fn()
        }}
      />
    );
    test.expect(test.screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    test.expect(test.screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    await test.userEvent.click(test.screen.getByRole('radio', { name: 'Light' }));
    test.expect(select).toHaveBeenCalledWith('light');
    test
      .expect(test.screen.getByRole('button', { name: 'Ocean' }))
      .toHaveAttribute('aria-pressed', 'true');
    test.expect(test.screen.getByRole('button', { name: 'Add theme' })).toBeInTheDocument();
  }
);

function appearanceModel() {
  return {
    data: {
      settings: { appearance: 2 as const, language: 1 as const, zoomPercent: 100, onboarded: true },
      preferences: { contrast: 100, glassOpacity: 80, animationDurationMs: 150 },
      selected: 'ocean',
      themes: [{ version: 1 as const, id: 'ocean', name: 'Ocean', builtin: true }]
    },
    loading: false,
    error: false,
    pending: false,
    retry: test.vi.fn(),
    setPreferences: test.vi.fn(),
    setZoom: test.vi.fn(),
    setAppearance: test.vi.fn(),
    selectTheme: test.vi.fn(),
    importTheme: test.vi.fn().mockResolvedValue({}),
    saveTheme: test.vi.fn().mockResolvedValue({}),
    deleteTheme: test.vi.fn().mockResolvedValue(undefined)
  };
}

test.stable(
  'validates pasted JSON before importing and keeps invalid input available to correct',
  async () => {
    const model = appearanceModel();
    const user = test.userEvent.setup();

    test.render(<PageView open onClose={test.vi.fn()} model={model} />);
    await user.click(test.screen.getByRole('button', { name: 'Add theme' }));
    const field = test.screen.getByRole('textbox', { name: 'Theme JSON' });

    await user.click(field);
    await user.paste('{"version":1}');
    await user.click(test.screen.getByRole('button', { name: 'Save' }));
    test
      .expect(await test.screen.findByRole('alert'))
      .toHaveTextContent('Could not save this theme');
    test.expect(model.importTheme).not.toHaveBeenCalled();
    await user.clear(field);
    await user.click(field);
    await user.paste('{"version":1,"id":"my-theme","name":"My theme","dark":{"primary":"blue"}}');
    await user.click(test.screen.getByRole('button', { name: 'Save' }));
    test.expect(model.importTheme).toHaveBeenCalledWith(test.expect.stringContaining('my-theme'));
  }
);

test.stable('duplicates protected themes into a portable editable definition', async () => {
  const model = appearanceModel();
  const user = test.userEvent.setup();

  test.render(<PageView open onClose={test.vi.fn()} model={model} />);
  test
    .expect(test.screen.queryByRole('button', { name: 'Delete theme: Ocean' }))
    .not.toBeInTheDocument();
  await user.click(test.screen.getByRole('button', { name: 'Duplicate theme: Ocean' }));
  const json = JSON.parse(
    (test.screen.getByRole('textbox', { name: 'Theme JSON' }) as HTMLTextAreaElement).value
  );

  test.expect(json.name).toBe('Ocean (copy)');
  test.expect(json.id).not.toBe('ocean');
  test.expect(json).not.toHaveProperty('builtin');
});

test.stable('supports arrow keys for scheme selection', async () => {
  const model = appearanceModel();
  const user = test.userEvent.setup();

  test.render(<PageView open onClose={test.vi.fn()} model={model} />);
  await user.click(test.screen.getByRole('radio', { name: 'Dark' }));
  model.setAppearance.mockClear();
  await user.keyboard('{ArrowLeft}');
  test.expect(model.setAppearance).toHaveBeenCalledWith('light');
});

test.stable('filters the theme library through settings search', async () => {
  const model = appearanceModel();
  const onSearch = test.vi.fn();
  const user = test.userEvent.setup();
  const { rerender } = test.render(
    <PageView open onClose={test.vi.fn()} model={model} search="" onSearch={onSearch} />
  );

  await user.type(test.screen.getByRole('searchbox', { name: 'Search settings' }), 'o');
  test.expect(onSearch).toHaveBeenCalledWith('o');
  rerender(
    <PageView open onClose={test.vi.fn()} model={model} search="iris" onSearch={onSearch} />
  );
  test.expect(test.screen.queryByRole('button', { name: 'Ocean' })).not.toBeInTheDocument();
});

test.stable('shows only working interface controls and saves their committed values', async () => {
  const model = appearanceModel();

  test.render(<PageView open onClose={test.vi.fn()} model={model} />);
  const contrast = test.screen.getByRole('slider', { name: 'Contrast' });

  test.fireEvent.change(contrast, { target: { value: '105' } });
  test.fireEvent.keyUp(contrast, { key: 'ArrowRight' });
  test.expect(model.setPreferences).toHaveBeenCalledWith({
    contrast: 105,
    glassOpacity: 80,
    animationDurationMs: 150
  });
  test.expect(test.screen.getByRole('slider', { name: 'Glass opacity' })).toBeInTheDocument();
  test
    .expect(test.screen.getByRole('slider', { name: 'Interface animations' }))
    .toBeInTheDocument();
  test.expect(test.screen.getByRole('slider', { name: 'Text size' })).toBeInTheDocument();
});

test.stable('groups settings navigation and shows relevant cross-section search results', () => {
  const onSectionChange = test.vi.fn();
  const { rerender } = test.render(
    <PageView
      open
      onClose={test.vi.fn()}
      model={appearanceModel()}
      onSectionChange={onSectionChange}
    />
  );

  const navigation = test.screen.getByRole('navigation', { name: 'Settings' });
  const labels = test
    .within(navigation)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

  test
    .expect(labels)
    .toEqual([
      'General',
      'Appearance',
      'Sidebar',
      'Writing',
      'Reading & exports',
      'Analytics',
      'Updates',
      'AI providers',
      'Models by task',
      'Custom instructions',
      'AI behavior',
      'AI usage',
      'Performance',
      'Flashcards',
      'Quizzes',
      'Fill in the blank',
      'Put in order',
      'Matching',
      'True or false',
      'Subjects',
      'Data & backups',
      'Integrations'
    ]);
  test
    .expect(
      test
        .within(navigation)
        .getAllByRole('heading')
        .map((heading) => heading.textContent)
    )
    .toEqual(['Workspace', 'AI', 'Practice', 'Library']);
  test
    .expect(test.screen.getByRole('button', { name: 'Appearance' }))
    .toHaveAttribute('aria-current', 'page');
  rerender(
    <PageView
      open
      onClose={test.vi.fn()}
      model={appearanceModel()}
      search="language"
      onSectionChange={onSectionChange}
    />
  );
  test.expect(test.screen.getByRole('region', { name: 'Settings matches' })).toBeInTheDocument();
  test.expect(test.screen.queryByText('Nothing matches.')).not.toBeInTheDocument();
  test.expect(test.screen.queryByRole('slider', { name: 'Contrast' })).not.toBeInTheDocument();
  rerender(
    <PageView
      open
      onClose={test.vi.fn()}
      model={appearanceModel()}
      search="ocean"
      onSectionChange={onSectionChange}
    />
  );
  test.expect(test.screen.getByRole('button', { name: 'Ocean' })).toBeInTheDocument();
  test.expect(test.screen.queryByText('Nothing matches.')).not.toBeInTheDocument();
});

test.stable.each([
  ['Concurrent', 'Performance', 'performance'],
  ['Search logs', 'Analytics', 'analytics'],
  ['Sidebar spacing', 'Sidebar', 'sidebar'],
  ['export', 'Reading & exports', 'reading'],
  ['Custom instructions', 'Custom instructions', 'instructions'],
  ['Questions per quiz', 'Quizzes', 'quizzes'],
  ['New cards per day', 'Flashcards', 'flashcards'],
  ['Automatic note titles', 'AI behavior', 'automation']
] as const)('finds %s under its focused %s section', (search, label, section) => {
  const onSectionChange = test.vi.fn();

  test.render(
    <PageView
      open
      onClose={test.vi.fn()}
      model={appearanceModel()}
      search={search}
      onSectionChange={onSectionChange}
    />
  );
  const matches = test.screen.getByRole('region', { name: 'Settings matches' });

  test.fireEvent.click(test.within(matches).getByRole('button', { name: label }));
  test.expect(onSectionChange).toHaveBeenCalledWith(section);
});

test.stable.each(['english', 'italian'] as const)(
  'finds automatic answers in the dedicated behavior section in %s',
  (locale) => {
    const onSectionChange = test.vi.fn();
    const copy = catalogs[locale];

    test.render(
      <LanguageProvider locale={locale}>
        <PageView
          open
          onClose={test.vi.fn()}
          model={appearanceModel()}
          search={copy.WorkspaceAutoAnswerQuestions}
          onSectionChange={onSectionChange}
        />
      </LanguageProvider>
    );
    const matches = test.screen.getByRole('region', { name: copy.SettingsSearchMatches });

    test.fireEvent.click(
      test.within(matches).getByRole('button', { name: copy.SettingsAiBehavior })
    );
    test.expect(onSectionChange).toHaveBeenCalledWith('automation');
    test.expect(test.within(matches).getAllByRole('button')).toHaveLength(1);
  }
);

for (const locale of ['english', 'italian'] as const) {
  test.stable(`finds updates through settings search in ${locale}`, () => {
    const change = test.vi.fn();
    const catalog = catalogs[locale];

    test.render(
      <LanguageProvider locale={locale}>
        <PageView
          open
          onClose={test.vi.fn()}
          model={appearanceModel()}
          search={catalog.UpdateCheck}
          onSectionChange={change}
        />
      </LanguageProvider>
    );
    test.fireEvent.click(
      test
        .within(test.screen.getByRole('region', { name: catalog.SettingsSearchMatches }))
        .getByRole('button', { name: catalog.Updates })
    );
    test.expect(change).toHaveBeenCalledWith('updates');
  });
}
