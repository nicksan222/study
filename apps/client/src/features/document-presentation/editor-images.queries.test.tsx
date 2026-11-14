import { contentSnapshotIdSchema, projectIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { blankDocument } from '../document-editing/block-editor';
import { importedSource } from '../material-library/test/support';
import { useDocumentEditorImages } from './editor-images.queries';

const rpc = vi.hoisted(() => ({ create: vi.fn(), export: vi.fn() }));

const createUrl = vi.fn(() => 'blob:exact-image');

const revokeUrl = vi.fn();

beforeEach(() => {
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(document = blankDocument()) {
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

testStable(
  'retains uploaded image bytes in the document subject before returning a canonical reference',
  async () => {
    rpc.create.mockResolvedValue({
      ...importedSource,
      id: sourceIdSchema.make(17n),
      kind: 'image',
      name: 'diagram.png'
    });
    const view = mount();
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

testStable('rejects non-image files before creating a source', async () => {
  const view = mount();

  await expect(
    view.result.current.upload(
      file('note.txt', 'text/plain', new TextEncoder().encode('Not an image'))
    )
  ).rejects.toMatchObject({ kind: 'invalid_input' });
  expect(rpc.create).not.toHaveBeenCalled();
});

testStable(
  'resolves the exact revision and revokes its preview after availability fails',
  async () => {
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
    const view = mount(document);

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
