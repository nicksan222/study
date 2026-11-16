import {
  render as renderReact,
  renderHook as renderReactHook,
  screen,
  act,
  waitFor
} from '@testing-library/react';
import type { RenderOptions, RenderHookOptions } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';

/** Rendering, hook props, interaction and DOM ownership shared by application-specific starters. */
export function createReactHarness(wrapper?: RenderOptions['wrapper']) {
  const roots = new DisposableStack();
  let closed = false;

  function container() {
    if (closed) throw new ReferenceError('React scenario is closed');

    const element = document.createElement('div');

    document.body.append(element);
    roots.defer(() => element.remove());

    return element;
  }

  return {
    screen,
    act,
    waitFor,
    user: userEvent.setup(),
    render(ui: ReactNode, options?: Omit<RenderOptions, 'wrapper' | 'container' | 'baseElement'>) {
      const element = container();
      const view = renderReact(ui, { ...options, wrapper, container: element });

      roots.defer(view.unmount);

      return view;
    },
    renderHook<Result, Props>(
      callback: (props: Props) => Result,
      options?: Omit<RenderHookOptions<Props>, 'wrapper' | 'container' | 'baseElement'>
    ) {
      const element = container();
      const view = renderReactHook(callback, { ...options, wrapper, container: element });

      roots.defer(view.unmount);

      return view;
    },
    close() {
      if (closed) return;

      closed = true;
      roots.dispose();
    }
  };
}
