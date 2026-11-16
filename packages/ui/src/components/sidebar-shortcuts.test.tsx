import { test } from '@study/testing';
import { useState } from 'react';
import type { ReactNode } from 'react';

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
                  href={'#' + name}
                  aria-label={name}
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

test.stable('opens the first nine current sidebar destinations with Command or Control', () => {
  test.render(
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

    test.fireEvent(window, event);
    test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent(expected);
    test.expect(test.screen.getByRole('link', { name: expected })).toHaveFocus();
    test.expect(event.defaultPrevented).toBe(true);
  }
});

test.stable('uses the updated rendered order without retaining old page or filter results', () => {
  const view = test.render(<Destinations names={['old first', 'old second']} />);

  view.rerender(<Destinations names={['new first', 'new second']} />);
  test.fireEvent.keyDown(window, { key: '2', metaKey: true });
  test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('new second');
  const missing = new KeyboardEvent('keydown', { key: '9', metaKey: true, cancelable: true });

  test.fireEvent(window, missing);
  test.expect(missing.defaultPrevented).toBe(false);
  test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('new second');
});

test.stable(
  'skips hidden, collapsed and disabled destinations and ignores section navigation',
  () => {
    test.render(
      <Destinations
        names={['available']}
        before={
          <>
            <div hidden>
              <Sidebar.Item
                label="Hidden"
                icon={null}
                render={<a href="#hidden" aria-label="Hidden" />}
              />
            </div>
            <details>
              <summary>Closed group</summary>
              <Sidebar.Item
                label="Collapsed"
                icon={null}
                render={<a href="#collapsed" aria-label="Collapsed" />}
              />
            </details>
            <Sidebar.Item
              label="Disabled"
              icon={null}
              aria-disabled="true"
              render={<a href="#disabled" aria-label="Disabled" />}
            />
          </>
        }
      />
    );

    test.fireEvent.keyDown(window, { key: '1', metaKey: true });
    test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('available');
  }
);

test.stable('does not intercept modified shortcuts, composition, repeats or modal tasks', () => {
  const view = test.render(
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
    test.fireEvent.keyDown(window, options);

  test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('none');

  view.rerender(
    <>
      <Destinations names={['one']} />
      <div role="dialog" aria-modal="true">
        Confirm
      </div>
    </>
  );
  test.fireEvent.keyDown(window, { key: '1', metaKey: true });
  test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('none');
});

test.stable('allows switching while writing in a notebook or document editor', () => {
  test.render(
    <>
      <Destinations names={['one', 'two']} />
      <textarea aria-label="Notebook" />
      <div contentEditable role="textbox" aria-label="Document" />
    </>
  );

  test.fireEvent.keyDown(test.screen.getByLabelText('Notebook'), { key: '1', metaKey: true });
  test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('one');
  test.fireEvent.keyDown(test.screen.getByLabelText('Document'), { key: '2', metaKey: true });
  test.expect(test.screen.getByLabelText('Selected item')).toHaveTextContent('two');
});

test.stable('shows numbered hints only while the navigation modifier is held', () => {
  test.render(
    <Destinations
      names={['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']}
    />
  );
  const first = test.screen.getByRole('link', { name: 'one' });

  test.expect(first).not.toHaveAttribute('data-sidebar-shortcut');
  test.fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
  test.expect(first).toHaveAttribute('data-sidebar-shortcut', '1');
  test
    .expect(test.screen.getByRole('link', { name: 'nine' }))
    .toHaveAttribute('data-sidebar-shortcut', '9');
  test
    .expect(test.screen.getByRole('link', { name: 'ten' }))
    .not.toHaveAttribute('data-sidebar-shortcut');
  test.fireEvent.keyUp(window, { key: 'Meta' });
  test.expect(first).not.toHaveAttribute('data-sidebar-shortcut');
  test.fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
  test.expect(first).toHaveAttribute('data-sidebar-shortcut', '1');
  test.fireEvent.blur(window);
  test.expect(first).not.toHaveAttribute('data-sidebar-shortcut');
});

test.stable(
  'updates held-key hints when the current list changes and clears them for modal tasks',
  async () => {
    const view = test.render(<Destinations names={['one', 'two']} />);

    test.fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
    view.rerender(<Destinations names={['two', 'one']} />);
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('link', { name: 'two' }))
        .toHaveAttribute('data-sidebar-shortcut', '1')
    );
    view.rerender(
      <>
        <Destinations names={['two', 'one']} />
        <div role="dialog" aria-modal="true">
          Confirm
        </div>
      </>
    );
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('link', { name: 'two' }))
        .not.toHaveAttribute('data-sidebar-shortcut')
    );
  }
);
