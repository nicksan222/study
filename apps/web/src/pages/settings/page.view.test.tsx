import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { PageView } from './page.view';

it('composes an appearance-only popup with accessible scheme and theme selection', async () => {
  const select = vi.fn();

  render(
    <PageView
      open
      onClose={vi.fn()}
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
        retry: vi.fn(),
        setPreferences: vi.fn(),
        setZoom: vi.fn(),
        setAppearance: select,
        selectTheme: vi.fn(),
        importTheme: vi.fn(),
        saveTheme: vi.fn(),
        deleteTheme: vi.fn()
      }}
    />
  );
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
  expect(select).toHaveBeenCalledWith('light');
  expect(screen.getByRole('button', { name: 'Ocean' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Add theme' })).toBeInTheDocument();
});

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
    retry: vi.fn(),
    setPreferences: vi.fn(),
    setZoom: vi.fn(),
    setAppearance: vi.fn(),
    selectTheme: vi.fn(),
    importTheme: vi.fn().mockResolvedValue({}),
    saveTheme: vi.fn().mockResolvedValue({}),
    deleteTheme: vi.fn().mockResolvedValue(undefined)
  };
}

it('validates pasted JSON before importing and keeps invalid input available to correct', async () => {
  const model = appearanceModel();
  const user = userEvent.setup();

  render(<PageView open onClose={vi.fn()} model={model} />);
  await user.click(screen.getByRole('button', { name: 'Add theme' }));
  const field = screen.getByRole('textbox', { name: 'Theme JSON' });

  await user.click(field);
  await user.paste('{"version":1}');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this theme');
  expect(model.importTheme).not.toHaveBeenCalled();
  await user.clear(field);
  await user.click(field);
  await user.paste('{"version":1,"id":"my-theme","name":"My theme","dark":{"primary":"blue"}}');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(model.importTheme).toHaveBeenCalledWith(expect.stringContaining('my-theme'));
});

it('duplicates protected themes into a portable editable definition', async () => {
  const model = appearanceModel();
  const user = userEvent.setup();

  render(<PageView open onClose={vi.fn()} model={model} />);
  expect(screen.queryByRole('button', { name: 'Delete theme: Ocean' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Duplicate theme: Ocean' }));
  const json = JSON.parse(
    (screen.getByRole('textbox', { name: 'Theme JSON' }) as HTMLTextAreaElement).value
  );

  expect(json.name).toBe('Ocean (copy)');
  expect(json.id).not.toBe('ocean');
  expect(json).not.toHaveProperty('builtin');
});

it('supports arrow keys for scheme selection', async () => {
  const model = appearanceModel();
  const user = userEvent.setup();

  render(<PageView open onClose={vi.fn()} model={model} />);
  await user.click(screen.getByRole('radio', { name: 'Dark' }));
  model.setAppearance.mockClear();
  await user.keyboard('{ArrowLeft}');
  expect(model.setAppearance).toHaveBeenCalledWith('light');
});

it('filters the theme library through settings search', async () => {
  const model = appearanceModel();
  const onSearch = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <PageView open onClose={vi.fn()} model={model} search="" onSearch={onSearch} />
  );

  await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'o');
  expect(onSearch).toHaveBeenCalledWith('o');
  rerender(<PageView open onClose={vi.fn()} model={model} search="iris" onSearch={onSearch} />);
  expect(screen.queryByRole('button', { name: 'Ocean' })).not.toBeInTheDocument();
});

it('shows only working interface controls and saves their committed values', async () => {
  const model = appearanceModel();

  render(<PageView open onClose={vi.fn()} model={model} />);
  const contrast = screen.getByRole('slider', { name: 'Contrast' });

  fireEvent.change(contrast, { target: { value: '105' } });
  fireEvent.keyUp(contrast, { key: 'ArrowRight' });
  expect(model.setPreferences).toHaveBeenCalledWith({
    contrast: 105,
    glassOpacity: 80,
    animationDurationMs: 150
  });
  expect(screen.getByRole('slider', { name: 'Glass opacity' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Interface animations' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Text size' })).toBeInTheDocument();
});

it('orders a single settings list and shows relevant cross-section search results', () => {
  const onSectionChange = vi.fn();
  const { rerender } = render(
    <PageView open onClose={vi.fn()} model={appearanceModel()} onSectionChange={onSectionChange} />
  );

  const navigation = screen.getByRole('navigation', { name: 'Settings' });
  const labels = within(navigation)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

  expect(labels.slice(0, 5)).toEqual([
    'General',
    'Appearance',
    'Writing',
    'Sessions',
    'Reading & exports'
  ]);
  expect(within(navigation).queryByRole('heading')).not.toBeInTheDocument();
  expect(labels).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  rerender(
    <PageView
      open
      onClose={vi.fn()}
      model={appearanceModel()}
      search="language"
      onSectionChange={onSectionChange}
    />
  );
  expect(screen.getByRole('region', { name: 'Settings matches' })).toBeInTheDocument();
  expect(screen.queryByText('Nothing matches.')).not.toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Contrast' })).not.toBeInTheDocument();
  rerender(
    <PageView
      open
      onClose={vi.fn()}
      model={appearanceModel()}
      search="ocean"
      onSectionChange={onSectionChange}
    />
  );
  expect(screen.getByRole('button', { name: 'Ocean' })).toBeInTheDocument();
  expect(screen.queryByText('Nothing matches.')).not.toBeInTheDocument();
});
