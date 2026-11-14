import { testStable } from '@study/testing/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { authoredPage as material } from '../document-editing/test-support';
import { usePageMetadata } from './note-page-metadata.queries';

const api = vi.hoisted(() => ({ description: vi.fn() }));

function mount() {
  const fixture = rpcTestTransport(async (_tag, input) => api.description(input));
  const original = { ...material(), description: 'Original summary' };

  return { original, ...renderHook(() => usePageMetadata(original), { wrapper: fixture.wrapper }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.description.mockResolvedValue(material());
});
afterEach(() => {
  cleanup();
});

testStable(
  'updates document metadata with the expected stored description and trimmed title',
  async () => {
    const view = mount();

    act(() => {
      view.result.current.setTitle('  Lecture notes  ');
      view.result.current.setDescription('  Study this tomorrow  ');
    });
    await act(() => view.result.current.mutation.mutateAsync());
    expect(api.description).toHaveBeenCalledWith({
      id: view.original.id,
      expectedDescription: 'Original summary',
      description: 'Study this tomorrow',
      expectedTitle: view.original.title,
      title: 'Lecture notes'
    });
  }
);

testStable('keeps edits on a description conflict and does not rename the material', async () => {
  const view = mount();

  api.description.mockRejectedValue(new Error('conflict'));
  act(() => {
    view.result.current.setDescription('My summary');
    view.result.current.mutation.mutate();
  });
  await waitFor(() => expect(view.result.current.mutation.isError).toBe(true));
  expect(view.result.current.description).toBe('My summary');
  expect(view.result.current.title).toBe(view.original.title);
});
