import { test } from '@study/testing';
import { createRef } from 'react';

import { Loading, LoadingSkeleton } from './loading';

test.stable('announces an inline load once and hides the decorative spinner', () => {
  test.render(<Loading label="Loading subjects" />);
  const status = test.screen.getByRole('status');

  test.expect(status).toHaveTextContent('Loading subjects');
  test.expect(status).toHaveAttribute('aria-atomic', 'true');
  test.expect(test.screen.getAllByRole('status')).toHaveLength(1);
  test.expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  test.expect(status).not.toHaveAttribute('aria-busy');
});

test.stable('supports panel and sidebar layouts without caller styling', () => {
  const { rerender } = test.render(<Loading label="Loading study" layout="panel" />);

  test.expect(test.screen.getByRole('status')).toHaveAttribute('data-layout', 'panel');
  rerender(<Loading label="Caricamento materie" layout="sidebar" />);
  test.expect(test.screen.getByRole('status')).toHaveAttribute('data-layout', 'sidebar');
  test.expect(test.screen.getByRole('status')).toHaveTextContent('Caricamento materie');
});

test.stable('forwards a ref and descriptive attributes', () => {
  const ref = createRef<HTMLSpanElement>();

  test.render(
    <Loading label="Searching" id="search-loading" ref={ref} aria-describedby="search-help" />
  );
  test.expect(ref.current).toBe(test.screen.getByRole('status'));
  test.expect(ref.current).toHaveAttribute('id', 'search-loading');
  test.expect(ref.current).toHaveAttribute('aria-describedby', 'search-help');
});

test.stable('gives skeletons one localized announcement and hides placeholder content', () => {
  const { container } = test.render(
    <LoadingSkeleton label="Caricamento studio" layout="sidebar" />
  );
  const status = test.screen.getByRole('status');

  test.expect(status).toHaveTextContent('Caricamento studio');
  test.expect(status).toHaveAttribute('aria-atomic', 'true');
  test.expect(status).toHaveAttribute('data-layout', 'sidebar');
  test.expect(test.screen.getAllByRole('status')).toHaveLength(1);
  test
    .expect(container.querySelector('[data-slot="loading-placeholder"]'))
    .toHaveAttribute('aria-hidden', 'true');
  test.expect(status).not.toHaveAttribute('aria-busy');
});
