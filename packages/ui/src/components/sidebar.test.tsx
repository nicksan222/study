import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { Sidebar } from './sidebar';

beforeEach(() => localStorage.clear());

testStable('resizes by dragging its edge and remembers the committed width', () => {
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

testStable('supports keyboard resizing and resets with a double click', async () => {
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

testStable('removes the resize rail when collapsed', () => {
  render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <aside />
      <main />
    </Sidebar.Frame>
  );
  expect(screen.queryByRole('separator')).not.toBeInTheDocument();
});

testStable(
  'clamps a restored width and tracks smaller viewports without losing the preference',
  () => {
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

testStable(
  'places trailing footer actions in a dedicated slot and respects utility variants',
  () => {
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

testStable(
  'searches subject identities while preserving their metadata and current selection',
  async () => {
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

testStable(
  'supports keyboard selection and returns focus when the subject picker closes',
  async () => {
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

testStable('keeps settled-group disclosure usable in the collapsed rail', async () => {
  const user = userEvent.setup();

  render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <Sidebar.NoteGroup title="Settled" count={1}>
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    </Sidebar.Frame>
  );
  const summary = screen.getByText('Settled').closest('summary')!;
  const group = summary.closest('details')!;

  expect(group).not.toHaveAttribute('open');
  await user.click(summary);
  expect(group).toHaveAttribute('open');
  expect(screen.getByRole('link', { name: 'Settled note' })).toBeVisible();
  await user.click(summary);
  expect(group).not.toHaveAttribute('open');
});

testStable('preserves supporting activity and counts in compact note rows', () => {
  render(
    <Sidebar.Item
      layout="compact"
      label="Note"
      icon={<span>Icon</span>}
      timestamp={<time>Now</time>}
      description={
        <>
          <span>Writing</span>
          <Sidebar.NoteCount>3</Sidebar.NoteCount>
        </>
      }
    />
  );
  const row = screen.getByRole('button', { name: /Note/ });

  expect(row).toHaveAttribute('data-layout', 'compact');
  expect(screen.getByText('Writing')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

testStable(
  'slides settled content closed before removing the native open state and restores it on reopening',
  async () => {
    render(
      <Sidebar.NoteGroup title="Settled" count={1} defaultOpen variant="settled">
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    );
    const summary = screen.getByText('Settled').closest('summary')!;
    const group = summary.closest('details')!;

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(group).toHaveAttribute('open');
    const body = group.querySelector('.study-note-group-body')!;

    expect(body).toHaveAttribute('aria-hidden', 'true');
    expect(body).toHaveAttribute('inert');
    fireEvent.transitionEnd(group.querySelector('.study-note-group-slide')!);
    expect(group).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(group).toHaveAttribute('open');
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('link', { name: 'Settled note' })).toBeVisible();
  }
);

testStable(
  'keeps a reopened settled group open when the previous close transition finishes',
  async () => {
    render(
      <Sidebar.NoteGroup title="Settled" count={1} defaultOpen variant="settled">
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    );
    const summary = screen.getByText('Settled').closest('summary')!;

    fireEvent.click(summary);
    fireEvent.click(summary);
    await waitFor(() => expect(summary).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.transitionEnd(summary.closest('details')!.querySelector('.study-note-group-slide')!);
    expect(summary.closest('details')).toHaveAttribute('open');
  }
);

testStable('closes settled content immediately when reduced motion is enabled', () => {
  const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);

  try {
    render(
      <Sidebar.NoteGroup title="Settled" count={1} defaultOpen variant="settled">
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    );
    const summary = screen.getByText('Settled').closest('summary')!;

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary.closest('details')).not.toHaveAttribute('open');
  } finally {
    media.mockRestore();
  }
});

testStable(
  'caps populated sections without reserving a share for empty sections or draft cards',
  async () => {
    const geometry = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, 0, 280, this.tagName === 'SUMMARY' ? 38 : 64);
      });
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);

    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}

        disconnect() {}
      }
    );
    const layout = (count: number) => (
      <Sidebar.Content style={{ rowGap: 12 }}>
        <Sidebar.NoteGroups>
          <Sidebar.NoteEntry>Draft card</Sidebar.NoteEntry>
          <Sidebar.NoteGroup title="Open" count={10} defaultOpen>
            <p>Open notes</p>
          </Sidebar.NoteGroup>
          <Sidebar.NoteGroup title="Settled" count={count} defaultOpen variant="settled">
            <Sidebar.SettledRows>{count > 0 && <p>Settled note</p>}</Sidebar.SettledRows>
          </Sidebar.NoteGroup>
        </Sidebar.NoteGroups>
      </Sidebar.Content>
    );
    const view = render(layout(0));

    try {
      const open = screen.getByText('Open').closest('details')!;
      const settled = screen.getByText('Settled').closest('details')!;

      expect(settled).toHaveAttribute('data-empty');
      expect(settled.style.getPropertyValue('--sidebar-group-content-max')).toBe('0px');
      expect(open.style.getPropertyValue('--sidebar-group-content-max')).toBe('236px');
      view.rerender(layout(1));
      await waitFor(() => expect(settled).not.toHaveAttribute('data-empty'));
      await waitFor(() =>
        expect(open.style.getPropertyValue('--sidebar-group-content-max')).toBe('118px')
      );
      expect(settled.style.getPropertyValue('--sidebar-group-content-max')).toBe('118px');
    } finally {
      view.unmount();
      geometry.mockRestore();
      height.mockRestore();
      vi.unstubAllGlobals();
    }
  }
);
