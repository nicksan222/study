import { test } from '@study/testing';
import { screen } from '@testing-library/react';
import { createContext, createElement, useContext, useState } from 'react';
import type { ReactNode } from 'react';

import { createReactHarness } from '../src/react.ts';

const Label = createContext('missing');

function Counter() {
  const label = useContext(Label);
  const [count, setCount] = useState(0);

  return createElement('button', { onClick: () => setCount(count + 1) }, `${label} ${count}`);
}

test.stable(
  'React harnesses bind providers and user interaction and release their rendered roots',
  async () => {
    const harness = createReactHarness(({ children }: { children: ReactNode }) =>
      createElement(Label.Provider, { value: 'Count' }, children)
    );

    try {
      harness.render(createElement(Counter));
      await harness.user.click(harness.screen.getByRole('button', { name: 'Count 0' }));
      test.expect(harness.screen.getByRole('button', { name: 'Count 1' })).toBeVisible();
    } finally {
      harness.close();
    }

    test.expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
);

test.stable('hook harnesses retain typed props through rerender and use the same providers', () => {
  const harness = createReactHarness(({ children }: { children: ReactNode }) =>
    createElement(Label.Provider, { value: 'Context' }, children)
  );

  try {
    const hook = harness.renderHook(
      ({ value }: { value: number }) => `${useContext(Label)} ${value}`,
      {
        initialProps: { value: 1 }
      }
    );

    test.expect(hook.result.current).toBe('Context 1');
    hook.rerender({ value: 2 });
    test.expect(hook.result.current).toBe('Context 2');
  } finally {
    harness.close();
  }
});

test.stable('shared React setup waits for delayed UI without case-specific timeouts', async () => {
  const button = document.createElement('button');

  button.textContent = 'Loaded action';
  const timer = setTimeout(() => document.body.append(button), 1200);

  try {
    test.expect(await screen.findByRole('button', { name: 'Loaded action' })).toBe(button);
  } finally {
    clearTimeout(timer);
    button.remove();
  }
});

test.stable(
  'React harnesses remove containers after failed rendering and reject use after close',
  () => {
    const harness = createReactHarness();
    const before = document.body.childElementCount;

    function Broken(): never {
      throw new Error('Render failed');
    }

    test.expect(() => harness.render(createElement(Broken))).toThrow('Render failed');
    harness.close();
    test.expect(document.body.childElementCount).toBe(before);
    test.expect(() => harness.render(createElement(Counter))).toThrow('React scenario is closed');
    harness.close();
  }
);
