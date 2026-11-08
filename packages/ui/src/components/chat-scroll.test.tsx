import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { ChatNote } from './chat';

function Note({ count = 2, first = 'first' }: { count?: number; first?: string }) {
  return (
    <div className="workspace-desk-notebook">
      <div data-notebook-scroll-host>
        <ChatNote
          label="Notebook"
          jumpLabel="Latest"
          itemCount={count}
          firstItemKey={first}
          navigation={<nav aria-label="Page index">Markers</nav>}
        >
          <p>Notebook content</p>
        </ChatNote>
      </div>
      <div data-notebook-navigation-host />
    </div>
  );
}

function dimensions(host: HTMLElement, height: number) {
  Object.defineProperty(host, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 200 });
}

testStable(
  'uses the workspace scroll host for reading position and the Latest action',
  async () => {
    const view = render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;
    const overlay = view.container.querySelector('[data-notebook-navigation-host]')!;

    dimensions(host, 1000);
    host.scrollTop = 100;
    const scroll = vi.fn();

    host.scrollTo = scroll;
    fireEvent.scroll(host);
    const latest = await screen.findByRole('button', { name: 'Latest' });

    expect(overlay).toContainElement(latest);
    expect(overlay).toContainElement(screen.getByRole('navigation', { name: 'Page index' }));
    fireEvent.click(latest);
    expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  }
);

testStable(
  'preserves the reader position when older entries are prepended in the workspace host',
  async () => {
    const view = render(<Note />);
    const host = view.container.querySelector<HTMLElement>('[data-notebook-scroll-host]')!;

    dimensions(host, 1000);
    host.scrollTop = 100;
    fireEvent.scroll(host);
    await screen.findByRole('button', { name: 'Latest' });
    dimensions(host, 1200);
    view.rerender(<Note count={3} first="older" />);
    await waitFor(() => expect(host.scrollTop).toBe(300));
  }
);
