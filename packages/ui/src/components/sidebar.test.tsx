import { test } from '@study/testing';
import { useState } from 'react';

import { Sidebar } from './sidebar';

test.beforeEach(() => localStorage.clear());

test.stable('resizes by dragging its edge and remembers the committed width', () => {
  const { container } = test.render(
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
  const separator = test.screen.getByRole('separator', { name: 'Resize sidebar' });

  test.fireEvent(
    separator,
    new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 320 })
  );
  test.fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, clientX: 420 }));
  test.fireEvent(separator, new MouseEvent('pointerup', { bubbles: true, clientX: 420 }));
  test.expect(separator).toHaveAttribute('aria-valuenow', '420');
  test
    .expect((container.firstChild as HTMLElement).style.getPropertyValue('--sidebar-width'))
    .toBe('420px');
  test.expect(localStorage.getItem('sidebar-test')).toBe('420');
});

test.stable('supports keyboard resizing and resets with a double click', async () => {
  const user = test.userEvent.setup();

  test.render(
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
  const separator = test.screen.getByRole('separator');

  separator.focus();
  await user.keyboard('{ArrowRight}');
  test.expect(separator).toHaveAttribute('aria-valuenow', '336');
  await user.keyboard('{Home}');
  test.expect(separator).toHaveAttribute('aria-valuenow', '208');
  test.fireEvent.doubleClick(separator);
  test.expect(separator).toHaveAttribute('aria-valuenow', '320');
});

test.stable('removes the resize rail when collapsed', () => {
  test.render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <aside />
      <main />
    </Sidebar.Frame>
  );
  test.expect(test.screen.queryByRole('separator')).not.toBeInTheDocument();
});

test.stable(
  'clamps a restored width and tracks smaller viewports without losing the preference',
  () => {
    localStorage.setItem('sidebar-test', '900');
    const originalWidth = window.innerWidth;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    const { container } = test.render(
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

    test.expect(test.screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '640');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 820 });
    test.fireEvent(window, new Event('resize'));
    test.expect(test.screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '460');
    test
      .expect((container.firstChild as HTMLElement).style.getPropertyValue('--sidebar-width'))
      .toBe('460px');
    test.expect(localStorage.getItem('sidebar-test')).toBe('900');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  }
);

test.stable(
  'places trailing footer actions in a dedicated slot and respects utility variants',
  () => {
    test.render(
      <Sidebar.Footer trailing={<Sidebar.Utility title="Settings" variant="secondary" />}>
        <Sidebar.Utility title="Notes" />
      </Sidebar.Footer>
    );
    const settings = test.screen.getByRole('button', { name: 'Settings' });

    test.expect(settings.parentElement).toHaveClass('study-sidebar-footer-trailing');
    test.expect(settings).toHaveClass('bg-secondary');
    test
      .expect(test.screen.getByRole('button', { name: 'Notes' }).parentElement)
      .toHaveClass('study-sidebar-footer');
  }
);

test.stable(
  'searches subject identities while preserving their metadata and current selection',
  async () => {
    const user = test.userEvent.setup();
    const subjects = [
      { id: 'biology', name: 'Biology', description: 'Exam 12 Dec 2026' },
      { id: 'history', name: 'History', description: 'Updated 1 Nov 2026' }
    ];
    const onValueChange = test.vi.fn();

    test.render(
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
    test
      .expect(test.screen.getByRole('option', { name: /Biology/ }))
      .toHaveAttribute('aria-selected', 'true');
    test
      .expect(test.screen.getByRole('option', { name: 'Biology' }))
      .toHaveAccessibleDescription('Exam 12 Dec 2026');
    test.expect(test.screen.getByText('Exam 12 Dec 2026')).toBeInTheDocument();
    await user.type(test.screen.getByRole('combobox', { name: 'Find subject' }), 'History');
    test.expect(test.screen.queryByRole('option', { name: /Biology/ })).not.toBeInTheDocument();
    await user.click(test.screen.getByRole('option', { name: /History/ }));
    test.expect(onValueChange).toHaveBeenCalledWith(subjects[1]);
  }
);

test.stable(
  'supports keyboard selection and returns focus when the subject picker closes',
  async () => {
    const user = test.userEvent.setup();
    const subjects = ['Biology', 'History'];
    const selected = test.vi.fn();

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

    test.render(<SubjectPicker />);
    await user.click(test.screen.getByRole('combobox', { name: 'Biology' }));
    const search = await test.screen.findByRole('combobox', { name: 'Find subject' });

    await user.type(search, 'History');
    await user.keyboard('{ArrowDown}{Enter}');
    test.expect(selected).toHaveBeenCalledWith('History');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('listbox')).not.toBeInTheDocument()
    );
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('combobox', { name: 'History' })).toHaveFocus()
    );
    await user.keyboard('{Enter}');
    test.expect(await test.screen.findByRole('option', { name: 'Biology' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('combobox', { name: 'History' })).toHaveFocus()
    );
  }
);

test.stable('keeps settled-group disclosure usable in the collapsed rail', async () => {
  const user = test.userEvent.setup();

  test.render(
    <Sidebar.Frame collapsed resizeLabel="Resize sidebar" resizeHint="Drag to resize">
      <Sidebar.NoteGroup title="Settled" count={1}>
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    </Sidebar.Frame>
  );
  const summary = test.screen.getByText('Settled').closest('summary')!;
  const group = summary.closest('details')!;

  test.expect(group).not.toHaveAttribute('open');
  await user.click(summary);
  test.expect(group).toHaveAttribute('open');
  test.expect(test.screen.getByRole('link', { name: 'Settled note' })).toBeVisible();
  await user.click(summary);
  test.expect(group).not.toHaveAttribute('open');
});

test.stable('preserves supporting activity and counts in compact note rows', () => {
  test.render(
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
  const row = test.screen.getByRole('button', { name: /Note/ });

  test.expect(row).toHaveAttribute('data-layout', 'compact');
  test.expect(test.screen.getByText('Writing')).toBeInTheDocument();
  test.expect(test.screen.getByText('3')).toBeInTheDocument();
});

test.stable(
  'slides settled content closed before removing the native open state and restores it on reopening',
  async () => {
    test.render(
      <Sidebar.NoteGroup title="Settled" count={1} defaultOpen variant="settled">
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    );
    const summary = test.screen.getByText('Settled').closest('summary')!;
    const group = summary.closest('details')!;

    test.fireEvent.click(summary);
    test.expect(summary).toHaveAttribute('aria-expanded', 'false');
    test.expect(group).toHaveAttribute('open');
    const body = group.querySelector('.study-note-group-body')!;

    test.expect(body).toHaveAttribute('aria-hidden', 'true');
    test.expect(body).toHaveAttribute('inert');
    test.fireEvent.transitionEnd(group.querySelector('.study-note-group-slide')!);
    test.expect(group).not.toHaveAttribute('open');
    test.fireEvent.click(summary);
    test.expect(group).toHaveAttribute('open');
    await test.waitFor(() => test.expect(summary).toHaveAttribute('aria-expanded', 'true'));
    test.expect(test.screen.getByRole('link', { name: 'Settled note' })).toBeVisible();
  }
);

test.stable(
  'keeps a reopened settled group open when the previous close transition finishes',
  async () => {
    test.render(
      <Sidebar.NoteGroup title="Settled" count={1} defaultOpen variant="settled">
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    );
    const summary = test.screen.getByText('Settled').closest('summary')!;

    test.fireEvent.click(summary);
    test.fireEvent.click(summary);
    await test.waitFor(() => test.expect(summary).toHaveAttribute('aria-expanded', 'true'));
    test.fireEvent.transitionEnd(
      summary.closest('details')!.querySelector('.study-note-group-slide')!
    );
    test.expect(summary.closest('details')).toHaveAttribute('open');
  }
);

test.stable('closes settled content immediately when reduced motion is enabled', () => {
  const media = test.vi
    .spyOn(window, 'matchMedia')
    .mockReturnValue({ matches: true } as MediaQueryList);

  try {
    test.render(
      <Sidebar.NoteGroup title="Settled" count={1} defaultOpen variant="settled">
        <a href="/notes/42">Settled note</a>
      </Sidebar.NoteGroup>
    );
    const summary = test.screen.getByText('Settled').closest('summary')!;

    test.fireEvent.click(summary);
    test.expect(summary).toHaveAttribute('aria-expanded', 'false');
    test.expect(summary.closest('details')).not.toHaveAttribute('open');
  } finally {
    media.mockRestore();
  }
});

test.stable(
  'caps populated sections without reserving a share for empty sections or draft cards',
  async () => {
    const geometry = test.vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, 0, 280, this.tagName === 'SUMMARY' ? 38 : 64);
      });
    const height = test.vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);

    test.vi.stubGlobal(
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
    const view = test.render(layout(0));

    try {
      const open = test.screen.getByText('Open').closest('details')!;
      const settled = test.screen.getByText('Settled').closest('details')!;

      test.expect(settled).toHaveAttribute('data-empty');
      test.expect(settled.style.getPropertyValue('--sidebar-group-content-max')).toBe('0px');
      test.expect(open.style.getPropertyValue('--sidebar-group-content-max')).toBe('236px');
      view.rerender(layout(1));
      await test.waitFor(() => test.expect(settled).not.toHaveAttribute('data-empty'));
      await test.waitFor(() =>
        test.expect(open.style.getPropertyValue('--sidebar-group-content-max')).toBe('118px')
      );
      test.expect(settled.style.getPropertyValue('--sidebar-group-content-max')).toBe('118px');
    } finally {
      view.unmount();
      geometry.mockRestore();
      height.mockRestore();
      test.vi.unstubAllGlobals();
    }
  }
);

test.stable('sidebar names include the visible navigation count and note metadata', () => {
  test.render(
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

  test.expect(test.screen.getByRole('button', { name: 'Pages 3' })).toBeInTheDocument();
  test
    .expect(test.screen.getByRole('button', { name: 'Biology Cell notes Draft' }))
    .toBeInTheDocument();
});
