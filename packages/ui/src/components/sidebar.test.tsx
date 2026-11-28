import { test } from '@study/testing';
import { useState } from 'react';

import { Sidebar } from './sidebar';

test.unit.beforeEach(() => localStorage.clear());

test.unit.stable(
  'resizes by dragging its edge and remembers the committed width',
  ({ render, screen, fireEvent, expect }) => {
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
  }
);

test.unit.stable(
  'supports keyboard resizing and resets with a double click',
  async ({ userEvent, render, screen, expect, fireEvent }) => {
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
  }
);

test.unit.stable('removes the resize rail when collapsed', ({ render, expect, screen }) => {
  render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <aside />
      <main />
    </Sidebar.Frame>
  );
  expect(screen.queryByRole('separator')).not.toBeInTheDocument();
});

test.unit.stable(
  'clamps a restored width and tracks smaller viewports without losing the preference',
  ({ render, expect, screen, fireEvent }) => {
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
  }
);

test.unit.stable(
  'places trailing footer actions in a dedicated slot and respects utility variants',
  ({ render, screen, expect }) => {
    render(
      <Sidebar.Footer trailing={<Sidebar.Utility title="Settings" variant="secondary" />}>
        <Sidebar.Utility title="Notes" />
      </Sidebar.Footer>
    );
    const settings = screen.getByRole('button', { name: 'Settings' });

    expect(settings.parentElement).toHaveClass('study-sidebar-footer-trailing');
    expect(settings).toHaveClass('bg-secondary');
    expect(screen.getByRole('button', { name: 'Notes' }).parentElement).toHaveClass(
      'study-sidebar-footer'
    );
  }
);

test.unit.stable(
  'searches subject identities while preserving their metadata and current selection',
  async ({ userEvent, vi, render, expect, screen }) => {
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
    expect(screen.getByRole('option', { name: /Biology/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('option', { name: 'Biology' })).toHaveAccessibleDescription(
      'Exam 12 Dec 2026'
    );
    expect(screen.getByText('Exam 12 Dec 2026')).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'Find subject' }), 'History');
    expect(screen.queryByRole('option', { name: /Biology/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /History/ }));
    expect(onValueChange).toHaveBeenCalledWith(subjects[1]);
  }
);

test.unit.stable(
  'supports keyboard selection and returns focus when the subject picker closes',
  async ({ userEvent, vi, render, screen, expect, waitFor }) => {
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
  }
);

test.unit.stable(
  'sidebar names include the visible navigation count and note metadata',
  ({ render, expect, screen }) => {
    render(
      <>
        <Sidebar.NavigationItem label="Pages" count={3}>
          <svg aria-hidden="true" />
        </Sidebar.NavigationItem>
        <Sidebar.Item
          label="Cell notes"
          icon={<svg aria-hidden="true" />}
          context="Biology"
          description="Draft"
        />
      </>
    );

    expect(screen.getByRole('button', { name: 'Pages 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Biology Cell notes Draft' })).toBeInTheDocument();
  }
);
