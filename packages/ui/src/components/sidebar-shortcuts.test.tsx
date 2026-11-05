import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { expect } from 'vite-plus/test';

import { Sidebar } from './sidebar';

function Destinations({ names, before }: { names: string[]; before?: ReactNode }) {
  const [selected, setSelected] = useState('none');

  return (
    <Sidebar.Root>
      <Sidebar.Navigation>
        <a href="#section">Section</a>
      </Sidebar.Navigation>
      <Sidebar.Content>
        {before}
        <Sidebar.Items>
          {names.map((name) => (
            <Sidebar.Item
              key={name}
              label={name}
              icon={null}
              render={
                <a
                  aria-label={name}
                  href={'#' + name}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelected(name);
                  }}
                />
              }
            />
          ))}
        </Sidebar.Items>
      </Sidebar.Content>
      <output aria-label="Selected item">{selected}</output>
    </Sidebar.Root>
  );
}

testStable('opens the first nine current sidebar destinations with Command or Control', () => {
  render(
    <Destinations
      names={['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']}
    />
  );

  for (const [key, modifier, expected] of [
    ['1', 'metaKey', 'one'],
    ['9', 'metaKey', 'nine'],
    ['3', 'ctrlKey', 'three']
  ] as const) {
    const event = new KeyboardEvent('keydown', {
      key,
      [modifier]: true,
      bubbles: true,
      cancelable: true
    });

    fireEvent(window, event);
    expect(screen.getByLabelText('Selected item')).toHaveTextContent(expected);
    expect(screen.getByRole('link', { name: expected })).toHaveFocus();
    expect(event.defaultPrevented).toBe(true);
  }
});

testStable('uses the updated rendered order without retaining old page or filter results', () => {
  const view = render(<Destinations names={['old first', 'old second']} />);

  view.rerender(<Destinations names={['new first', 'new second']} />);
  fireEvent.keyDown(window, { key: '2', metaKey: true });
  expect(screen.getByLabelText('Selected item')).toHaveTextContent('new second');
  const missing = new KeyboardEvent('keydown', { key: '9', metaKey: true, cancelable: true });

  fireEvent(window, missing);
  expect(missing.defaultPrevented).toBe(false);
  expect(screen.getByLabelText('Selected item')).toHaveTextContent('new second');
});

testStable(
  'skips hidden, collapsed and disabled destinations and ignores section navigation',
  () => {
    render(
      <Destinations
        names={['available']}
        before={
          <>
            <div hidden>
              <Sidebar.Item
                label="Hidden"
                icon={null}
                render={<a aria-label="Hidden" href="#hidden" />}
              />
            </div>
            <details>
              <summary>Closed group</summary>
              <Sidebar.Item
                label="Collapsed"
                icon={null}
                render={<a aria-label="Collapsed" href="#collapsed" />}
              />
            </details>
            <Sidebar.Item
              label="Disabled"
              icon={null}
              aria-disabled="true"
              render={<a aria-label="Disabled" href="#disabled" />}
            />
          </>
        }
      />
    );

    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(screen.getByLabelText('Selected item')).toHaveTextContent('available');
  }
);

testStable('does not intercept modified shortcuts, composition, repeats or modal tasks', () => {
  const view = render(
    <>
      <Destinations names={['one']} />
    </>
  );

  for (const options of [
    { key: '1' },
    { key: '1', metaKey: true, shiftKey: true },
    { key: '1', metaKey: true, altKey: true },
    { key: '1', metaKey: true, repeat: true },
    { key: '1', metaKey: true, isComposing: true }
  ])
    fireEvent.keyDown(window, options);

  expect(screen.getByLabelText('Selected item')).toHaveTextContent('none');

  view.rerender(
    <>
      <Destinations names={['one']} />
      <div role="dialog" aria-modal="true">
        Confirm
      </div>
    </>
  );
  fireEvent.keyDown(window, { key: '1', metaKey: true });
  expect(screen.getByLabelText('Selected item')).toHaveTextContent('none');
});

testStable('allows switching while writing in a notebook or document editor', () => {
  render(
    <>
      <Destinations names={['one', 'two']} />
      <textarea aria-label="Notebook" />
      <div contentEditable role="textbox" aria-label="Document" />
    </>
  );

  fireEvent.keyDown(screen.getByLabelText('Notebook'), { key: '1', metaKey: true });
  expect(screen.getByLabelText('Selected item')).toHaveTextContent('one');
  fireEvent.keyDown(screen.getByLabelText('Document'), { key: '2', metaKey: true });
  expect(screen.getByLabelText('Selected item')).toHaveTextContent('two');
});

testStable('shows numbered hints only while the navigation modifier is held', () => {
  render(
    <Destinations
      names={['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']}
    />
  );
  const first = screen.getByRole('link', { name: 'one' });

  expect(first).not.toHaveAttribute('data-sidebar-shortcut');
  fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
  expect(first).toHaveAttribute('data-sidebar-shortcut', '1');
  expect(screen.getByRole('link', { name: 'nine' })).toHaveAttribute('data-sidebar-shortcut', '9');
  expect(screen.getByRole('link', { name: 'ten' })).not.toHaveAttribute('data-sidebar-shortcut');
  fireEvent.keyUp(window, { key: 'Meta' });
  expect(first).not.toHaveAttribute('data-sidebar-shortcut');
  fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
  expect(first).toHaveAttribute('data-sidebar-shortcut', '1');
  fireEvent.blur(window);
  expect(first).not.toHaveAttribute('data-sidebar-shortcut');
});

testStable(
  'updates held-key hints when the current list changes and clears them for modal tasks',
  async () => {
    const view = render(<Destinations names={['one', 'two']} />);

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
    view.rerender(<Destinations names={['two', 'one']} />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'two' })).toHaveAttribute(
        'data-sidebar-shortcut',
        '1'
      )
    );
    view.rerender(
      <>
        <Destinations names={['two', 'one']} />
        <div role="dialog" aria-modal="true">
          Confirm
        </div>
      </>
    );
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'two' })).not.toHaveAttribute('data-sidebar-shortcut')
    );
  }
);
