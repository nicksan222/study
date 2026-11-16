import {
  contentSnapshotIdSchema,
  projectIdSchema,
  sourceIdSchema,
  createBlock
} from '@study/contracts';
import { test } from '@study/testing';
import { createRef, useImperativeHandle } from 'react';

import type * as __MockType0 from '../document-editing/block-editor';
import type * as __MockType1 from '../material-library/test/support';
import type * as __MockType2 from './editor-images.queries';

let blankDocument: typeof __MockType0.blankDocument;

let importedSource: typeof __MockType1.importedSource;

let useDocumentEditorImages: typeof __MockType2.useDocumentEditorImages;

let rpc: ReturnType<typeof createMockState>['rpc'];

let createUrl: ReturnType<typeof createMockState>['createUrl'];

let revokeUrl: ReturnType<typeof createMockState>['revokeUrl'];

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({ create: mock.fn(), export: mock.fn() }))(),
    createUrl: mock.fn(() => 'blob:exact-image'),
    revokeUrl: mock.fn()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;
  createUrl = __mockState.createUrl;
  revokeUrl = __mockState.revokeUrl;

  const __mockModule0 = await import('../document-editing/block-editor');

  blankDocument = __mockModule0.blankDocument;
  const __mockModule1 = await import('../material-library/test/support');

  importedSource = __mockModule1.importedSource;
  const __mockModule2 = await import('./editor-images.queries');

  useDocumentEditorImages = __mockModule2.useDocumentEditorImages;
});

test.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  const NativeURL = URL;

  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    }
  );
  createUrl.mockReturnValue('blob:exact-image');
});
test.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  { rpcTestTransport, render }: Pick<test.Context, 'rpcTestTransport' | 'render'>,
  document = blankDocument()
) {
  const fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'sources.createSource') return rpc.create(input);

    if (tag === 'sources.exportRevision') return rpc.export(input);

    throw new Error(`Unexpected ${tag}`);
  });
  const exposed = createRef<ReturnType<typeof useDocumentEditorImages>>();

  function Probe() {
    const latest = useDocumentEditorImages(
      document,
      contentSnapshotIdSchema.make(1n),
      projectIdSchema.make(5n)
    );

    useImperativeHandle(exposed, () => latest, [latest]);

    return <>{latest.subscriptions}</>;
  }

  const view = render(<Probe />, { wrapper: fixture.wrapper });

  return {
    ...view,
    result: {
      get current() {
        if (!exposed.current) throw new Error('Image hook is not mounted');

        return exposed.current;
      }
    },
    notify: fixture.notify
  };
}

function file(name: string, type: string, bytes: Uint8Array) {
  const value = new File([new Uint8Array(bytes)], name, { type });

  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.buffer });

  return value;
}

test.stable(
  'retains uploaded image bytes in the document subject before returning a canonical reference',
  async ({ expect, rpcTestTransport, render }) => {
    rpc.create.mockResolvedValue({
      ...importedSource,
      id: sourceIdSchema.make(17n),
      kind: 'image',
      name: 'diagram.png'
    });
    const view = mount({ rpcTestTransport, render });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const image = file('diagram.png', 'image/png', bytes);
    const reference = await view.result.current.upload(image);

    expect(rpc.create).toHaveBeenCalledExactlyOnceWith({
      name: 'diagram.png',
      bytes,
      projectId: projectIdSchema.make(5n)
    });
    expect(reference).toEqual({ sourceId: '17', revision: 1, alt: 'diagram.png' });
    expect(reference).not.toHaveProperty('src');
  }
);

test.stable(
  'rejects non-image files before creating a source',
  async ({ expect, rpcTestTransport, render }) => {
    const view = mount({ rpcTestTransport, render });

    await expect(
      view.result.current.upload(
        file('note.txt', 'text/plain', new TextEncoder().encode('Not an image'))
      )
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    expect(rpc.create).not.toHaveBeenCalled();
  }
);

test.stable(
  'resolves the exact revision and revokes its preview after availability fails',
  async ({ waitFor, expect, act, rpcTestTransport, render }) => {
    const sourceId = sourceIdSchema.make(17n);

    rpc.export.mockResolvedValue({
      sourceId,
      revision: 1n,
      name: 'diagram.png',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3])
    });
    const document = {
      ...blankDocument(),
      blocks: [createBlock({ type: 'image', sourceId, revision: 1, alt: 'Diagram' })]
    };
    const view = mount({ rpcTestTransport, render }, document);

    await waitFor(() => expect(view.result.current.urls['17:1']).toBe('blob:exact-image'));
    expect(rpc.export).toHaveBeenCalledWith({ sourceId, revision: 1n });
    rpc.export.mockRejectedValue(new Error('Unavailable revision'));
    await act(async () => {
      await view.notify();
    });
    await waitFor(() => expect(view.result.current.urls['17:1']).toBeUndefined());
    expect(revokeUrl).toHaveBeenCalledWith('blob:exact-image');
    expect(view.result.current.error).toBeDefined();
  }
);
