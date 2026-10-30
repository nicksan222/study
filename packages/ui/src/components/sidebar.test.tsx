import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vite-plus/test';

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
