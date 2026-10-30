import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it } from 'vite-plus/test';

import { Loading, LoadingSkeleton } from './loading';

it('announces an inline load once and hides the decorative spinner', () => {
  render(<Loading label="Loading subjects" />);
  const status = screen.getByRole('status');

  expect(status).toHaveTextContent('Loading subjects');
  expect(status).toHaveAttribute('aria-atomic', 'true');
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(status).not.toHaveAttribute('aria-busy');
});

it('supports panel and sidebar layouts without caller styling', () => {
  const { rerender } = render(<Loading label="Loading study" layout="panel" />);

  expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'panel');
  rerender(<Loading label="Caricamento materie" layout="sidebar" />);
  expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'sidebar');
  expect(screen.getByRole('status')).toHaveTextContent('Caricamento materie');
});

it('forwards a ref and descriptive attributes', () => {
  const ref = createRef<HTMLSpanElement>();

  render(
    <Loading label="Searching" id="search-loading" ref={ref} aria-describedby="search-help" />
  );
  expect(ref.current).toBe(screen.getByRole('status'));
  expect(ref.current).toHaveAttribute('id', 'search-loading');
  expect(ref.current).toHaveAttribute('aria-describedby', 'search-help');
});

it('gives skeletons one localized announcement and hides placeholder content', () => {
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
});
