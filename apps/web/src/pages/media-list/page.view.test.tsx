import { render } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { PageView } from './page.view';

it('keeps the empty page presentation independent of application services', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const { container } = render(<PageView />);

  expect(container).toBeEmptyDOMElement();
  expect(fetch).not.toHaveBeenCalled();
});
