import { test } from '@study/testing';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './note-page-metadata.queries';

let material: typeof __MockType0.authoredPage;

let usePageMetadata: typeof __MockType1.usePageMetadata;

let api: ReturnType<typeof createMockState>['api'];

function mount({
  rpcTestTransport,
  renderHook
}: Pick<test.Context, 'rpcTestTransport' | 'renderHook'>) {
  const fixture = rpcTestTransport(async (_tag, input) => api.description(input));
  const original = { ...material(), description: 'Original summary' };

  return {
    original,
    ...renderHook(() => usePageMetadata(original), { wrapper: fixture.wrapper })
  };
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ description: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  const __mockModule0 = await import('../document-editing/test-support');

  material = __mockModule0.authoredPage;
  const __mockModule1 = await import('./note-page-metadata.queries');

  usePageMetadata = __mockModule1.usePageMetadata;
});

test.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  api.description.mockResolvedValue(material());
});
test.afterEach(({ cleanup }) => {
  cleanup();
});

test.stable(
  'updates document metadata with the expected stored description and trimmed title',
  async ({ act, expect, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });

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

test.stable(
  'keeps edits on a description conflict and does not rename the material',
  async ({ act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });

    api.description.mockRejectedValue(new Error('conflict'));
    act(() => {
      view.result.current.setDescription('My summary');
      view.result.current.mutation.mutate();
    });
    await waitFor(() => expect(view.result.current.mutation.isError).toBe(true));
    expect(view.result.current.description).toBe('My summary');
    expect(view.result.current.title).toBe(view.original.title);
  }
);
