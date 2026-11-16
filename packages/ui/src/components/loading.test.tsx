import { test } from '@study/testing';
import { createRef } from 'react';

import { Loading, LoadingSkeleton } from './loading';

test.stable(
  'announces an inline load once and hides the decorative spinner',
  ({ render, screen, expect }) => {
    render(<Loading label="Loading subjects" />);
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Loading subjects');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(status).not.toHaveAttribute('aria-busy');
  }
);

test.stable(
  'supports panel and sidebar layouts without caller styling',
  ({ render, expect, screen }) => {
    const { rerender } = render(<Loading label="Loading study" layout="panel" />);

    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'panel');
    rerender(<Loading label="Caricamento materie" layout="sidebar" />);
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'sidebar');
    expect(screen.getByRole('status')).toHaveTextContent('Caricamento materie');
  }
);

test.stable('forwards a ref and descriptive attributes', ({ render, expect, screen }) => {
  const ref = createRef<HTMLSpanElement>();

  render(
    <Loading label="Searching" id="search-loading" ref={ref} aria-describedby="search-help" />
  );
  expect(ref.current).toBe(screen.getByRole('status'));
  expect(ref.current).toHaveAttribute('id', 'search-loading');
  expect(ref.current).toHaveAttribute('aria-describedby', 'search-help');
});

test.stable(
  'gives skeletons one localized announcement and hides placeholder content',
  ({ render, screen, expect }) => {
    const { container } = render(<LoadingSkeleton label="Caricamento studio" layout="sidebar" />);
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Caricamento studio');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveAttribute('data-layout', 'sidebar');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelector('[data-slot="loading-placeholder"]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(status).not.toHaveAttribute('aria-busy');
  }
);
