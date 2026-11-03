import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { Sidebar } from './sidebar';

beforeEach(() => localStorage.clear());

it('resizes by dragging its edge and remembers the committed width', () => {
  const { container } = render(
    <Sidebar.Frame
      collapsed={false}
      defaultWidth={320}
      minWidth={208}
      minContentWidth={360}
      storageKey="sidebar-test"
      resizeLabel="Resize sidebar"
      resizeHint="Drag to resize"
    >
      <aside />
      <main />
    </Sidebar.Frame>
  );
  const separator = screen.getByRole('separator', { name: 'Resize sidebar' });

  fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 320 }));
  fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 420 }));
  fireEvent(separator, new MouseEvent('pointerup', { bubbles: true, clientX: 420 }));
  expect(separator).toHaveAttribute('aria-valuenow', '420');
  expect((container.firstChild as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe(
    '420px'
  );
  expect(localStorage.getItem('sidebar-test')).toBe('420');
});

it('supports keyboard resizing and resets with a double click', async () => {
  const user = userEvent.setup();

  render(
    <Sidebar.Frame
      collapsed={false}
      defaultWidth={320}
      minWidth={208}
      minContentWidth={360}
      resizeLabel="Resize sidebar"
      resizeHint="Drag to resize"
    >
      <aside />
      <main />
    </Sidebar.Frame>
  );
  const separator = screen.getByRole('separator');

  separator.focus();
  await user.keyboard('{ArrowRight}');
  expect(separator).toHaveAttribute('aria-valuenow', '336');
  await user.keyboard('{Home}');
  expect(separator).toHaveAttribute('aria-valuenow', '208');
  fireEvent.doubleClick(separator);
  expect(separator).toHaveAttribute('aria-valuenow', '320');
});

it('removes the resize rail when collapsed', () => {
  render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <aside />
      <main />
    </Sidebar.Frame>
  );
  expect(screen.queryByRole('separator')).not.toBeInTheDocument();
});

it('clamps a restored width and tracks smaller viewports without losing the preference', () => {
  localStorage.setItem('sidebar-test', '900');
  const originalWidth = window.innerWidth;

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  const { container } = render(
    <Sidebar.Frame
      collapsed={false}
      minWidth={208}
      minContentWidth={360}
      storageKey="sidebar-test"
      resizeLabel="Resize sidebar"
      resizeHint="Drag to resize"
    >
      <aside />
      <main />
    </Sidebar.Frame>
  );

  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '640');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 820 });
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '460');
  expect((container.firstChild as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe(
    '460px'
  );
  expect(localStorage.getItem('sidebar-test')).toBe('900');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

it('places trailing footer actions in a dedicated slot and respects utility variants', () => {
  render(
    <Sidebar.Footer trailing={<Sidebar.Utility title="Settings" variant="secondary" />}>
      <Sidebar.Utility title="Sessions" />
    </Sidebar.Footer>
  );
  const settings = screen.getByRole('button', { name: 'Settings' });

  expect(settings.parentElement).toHaveClass('study-sidebar-footer-trailing');
  expect(settings).toHaveClass('bg-secondary');
  expect(screen.getByRole('button', { name: 'Sessions' }).parentElement).toHaveClass(
    'study-sidebar-footer'
  );
});

it('searches subject identities while preserving their metadata and current selection', async () => {
  const user = userEvent.setup();
  const subjects = [
    { id: 'biology', name: 'Biology', description: 'Exam 12 Dec 2026' },
    { id: 'history', name: 'History', description: 'Updated 1 Nov 2026' }
  ];
  const onValueChange = vi.fn();

  render(
    <Sidebar.Picker
      items={subjects}
      value={subjects[0]!}
      getLabel={(item) => item.name}
      getValue={(item) => item.id}
      getDescription={(item) => item.description}
      listLabel="Subjects"
      onValueChange={onValueChange}
      open
      onOpenChange={() => {}}
      collapsed={false}
      label="Choose subject"
      searchLabel="Find subject"
      empty="No matches"
    />
  );
  expect(screen.getByRole('option', { name: /Biology/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: 'Biology' })).toHaveAccessibleDescription(
    'Exam 12 Dec 2026'
  );
  expect(screen.getByText('Exam 12 Dec 2026')).toBeInTheDocument();
  await user.type(screen.getByRole('combobox', { name: 'Find subject' }), 'History');
  expect(screen.queryByRole('option', { name: /Biology/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /History/ }));
  expect(onValueChange).toHaveBeenCalledWith(subjects[1]);
});

it('supports keyboard selection and returns focus when the subject picker closes', async () => {
  const user = userEvent.setup();
  const subjects = ['Biology', 'History'];
  const selected = vi.fn();

  function SubjectPicker() {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('Biology');

    return (
      <Sidebar.Picker
        items={subjects}
        value={value}
        getLabel={(item) => item}
        getValue={(item) => item}
        onValueChange={(item) => {
          setValue(item);
          selected(item);
        }}
        open={open}
        onOpenChange={setOpen}
        collapsed={false}
        label="Choose subject"
        searchLabel="Find subject"
        empty="No matches"
      />
    );
  }

  render(<SubjectPicker />);
  await user.click(screen.getByRole('combobox', { name: 'Biology' }));
  const search = await screen.findByRole('combobox', { name: 'Find subject' });

  await user.type(search, 'History');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(selected).toHaveBeenCalledWith('History');
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'History' })).toHaveFocus());
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('option', { name: 'Biology' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'History' })).toHaveFocus());
});

it('keeps settled-group disclosure usable in the collapsed rail', async () => {
  const user = userEvent.setup();

  render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <Sidebar.SessionGroup title="Settled" count={1}>
        <a href="/sessions/42">Settled session</a>
      </Sidebar.SessionGroup>
    </Sidebar.Frame>
  );
  const summary = screen.getByText('Settled').closest('summary')!;
  const group = summary.closest('details')!;

  expect(group).not.toHaveAttribute('open');
  await user.click(summary);
  expect(group).toHaveAttribute('open');
  expect(screen.getByRole('link', { name: 'Settled session' })).toBeVisible();
  await user.click(summary);
  expect(group).not.toHaveAttribute('open');
});
