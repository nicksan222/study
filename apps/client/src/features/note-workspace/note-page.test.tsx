import {
  StudyError,
  noteIdSchema,
  projectIdSchema,
  editOutcomeSchema,
  plainBlock
} from '@study/contracts';
import { RpcProvider, configureRpcTransport } from '@study/contracts/react';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../document-editing';
import type * as __MockType1 from '../document-editing/test-support';
import type * as __MockType2 from './note-page.queries';

let blankDocument: typeof __MockType0.blankDocument;

let authoredPage: typeof __MockType1.authoredPage;

let useNotePageCreation: typeof __MockType2.useNotePageCreation;

let useBlankPageCreation: typeof __MockType2.useBlankPageCreation;

let useNotePageAutosave: typeof __MockType2.useNotePageAutosave;

let useLinkedPages: typeof __MockType2.useLinkedPages;

let api: ReturnType<typeof createMockState>['api'];

const saveReceipt = (outcome: 'saved' | 'conflict', submitted: bigint, expected = 10n) =>
  Schema.decodeUnknownSync(editOutcomeSchema)({
    outcome,
    replayed: false,
    expectedVersionId: expected,
    submittedVersionId: submitted,
    currentVersionId: outcome === 'conflict' ? 11n : submitted
  });

const id = noteIdSchema.make(1n);

function initializeDocument() {
  return (text: string) => ({
    ...blankDocument(),
    blocks: [plainBlock('paragraph', text, { type: 'authored' })]
  });
}

let document: ReturnType<typeof initializeDocument>;

function initializeMaterial() {
  return (text = '', versionId = 10n) => authoredPage(2n, text, versionId);
}

let material: ReturnType<typeof initializeMaterial>;

const registries: AtomRegistry.AtomRegistry[] = [];

function mount<T>(hook: () => T, registry = AtomRegistry.make()) {
  registries.push(registry);
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.create') return api.create(input);

    if (tag === 'pages.save') return api.save(input);

    if (tag === 'pages.page') return api.material(input);

    if (tag === 'pages.pages') return api.list(input);

    throw new Error(`Unexpected ${tag}`);
  });

  configureRpcTransport(fixture.transport);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RpcProvider transport={fixture.transport} registry={registry}>
      {children}
    </RpcProvider>
  );

  return { registry, ...test.renderHook(hook, { wrapper }) };
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      create: mock.fn(),
      save: mock.fn(),
      material: mock.fn(),
      list: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  const __mockModule0 = await import('../document-editing');

  blankDocument = __mockModule0.blankDocument;
  const __mockModule1 = await import('../document-editing/test-support');

  authoredPage = __mockModule1.authoredPage;
  const __mockModule2 = await import('./note-page.queries');

  useNotePageCreation = __mockModule2.useNotePageCreation;
  useBlankPageCreation = __mockModule2.useBlankPageCreation;
  useNotePageAutosave = __mockModule2.useNotePageAutosave;
  useLinkedPages = __mockModule2.useLinkedPages;
  document = initializeDocument();
  material = initializeMaterial();
});

test.beforeEach(() => {
  test.vi.useFakeTimers();
  test.vi.resetAllMocks();
});
test.afterEach(() => {
  test.cleanup();
  registries.splice(0).forEach((registry) => registry.dispose());
  test.vi.useRealTimers();
});

async function settle() {
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(1);
  });
}

test.stable(
  'creates an empty real document attachment and reuses the exact creation receipt after uncertain transport',
  async () => {
    api.create
      .mockRejectedValueOnce(new StudyError('transient', 'offline'))
      .mockResolvedValueOnce(material());
    const view = mount(() => useNotePageCreation(id));

    await test.act(async () => {
      await view.result.current.create('New page');
    });
    const input = api.create.mock.calls[0]![0];

    test.expect(input).toMatchObject({
      noteId: id,
      title: 'New page',
      document: { blocks: [{ text: '' }] }
    });
    test.expect(input.createKey).toBeTruthy();
    await settle();
    test.expect(view.result.current.error).toBeDefined();
    await test.act(async () => {
      await view.result.current.retry();
    });
    test.expect(api.create.mock.calls[1]![0]).toEqual(input);
    await settle();
    test.expect(view.result.current.error).toBeUndefined();
  }
);

test.stable('autosaves typed pages and flushes trailing edits after the tab closes', async () => {
  let finish!: (value: typeof editOutcomeSchema.Type) => void;

  api.save
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(saveReceipt('saved', 12n, 11n));
  const initial = material();
  const view = mount(() => useNotePageAutosave(initial));
  const first = document('First');
  const last = document('Last');

  test.act(() => view.result.current.change(first));
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(3000);
  });
  test.expect(api.save.mock.calls[0]![0]).toMatchObject({
    pageId: initial.id,
    expectedVersionId: initial.version!.id,
    document: first
  });
  test.act(() => view.result.current.change(last));
  view.unmount();
  await test.act(async () => {
    finish(saveReceipt('saved', 11n, 10n));
  });
  test.expect(api.save).toHaveBeenCalledTimes(2);
  test.expect(api.save.mock.calls[1]![0]).toMatchObject({ document: last, expectedVersionId: 11n });
});

test.stable(
  'preserves a failed save payload and requires an explicit retry with the same save key',
  async () => {
    api.save
      .mockRejectedValueOnce(new StudyError('transient', 'lost receipt'))
      .mockResolvedValueOnce(saveReceipt('saved', 11n, 10n));
    const initial = material();
    const view = mount(() => useNotePageAutosave(initial));

    test.act(() => view.result.current.change(document('Draft')));
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(9000);
    });
    test.expect(api.save).toHaveBeenCalledTimes(1);
    await test.act(async () => {
      await view.result.current.save();
    });
    test.expect(api.save.mock.calls[1]![0]).toEqual(api.save.mock.calls[0]![0]);
    await settle();
    test.expect(view.result.current.dirty).toBe(false);
  }
);

test.stable(
  'retains local edits on conflict until the user selects the saved version',
  async () => {
    api.save.mockResolvedValue(saveReceipt('conflict', 12n, 10n));
    const incoming = material('Another editor', 11n);

    api.material.mockResolvedValue(incoming);
    const initial = material();
    const view = mount(() => useNotePageAutosave(initial));

    test.act(() => view.result.current.change(document('Local')));
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(3000);
    });
    await settle();
    test.expect(view.result.current.document.blocks[0]!.text).toBe('Local');
    test.expect(view.result.current.conflict?.id).toBe(initial.id);
    test.act(() => view.result.current.acceptSavedVersion());
    await settle();
    test.expect(view.result.current.document.blocks[0]!.text).toBe('Another editor');
  }
);

test.stable(
  'linked attachment pages remain bounded and request continuation only explicitly',
  async () => {
    const item = material();

    api.list.mockImplementation(async ({ limit }) => ({
      items: [item],
      nextCursor: limit < 60 ? item.id : null
    }));
    const view = mount(() => useLinkedPages(id));

    await settle();
    test.expect(view.result.current.data?.items).toHaveLength(1);
    test.expect(api.list).toHaveBeenCalledTimes(1);
    test.expect(api.list.mock.calls[0]![0]).toMatchObject({ noteId: id, limit: 30 });
    await test.act(async () => view.result.current.pagination.more(item.id));
    await settle();
    test.expect(api.list.mock.calls.at(-1)![0]).toMatchObject({ noteId: id, limit: 60 });
  }
);

test.stable(
  'creates a subject-owned blank document and retries the same receipt without attaching a note',
  async () => {
    const projectId = projectIdSchema.make(7n);

    api.create
      .mockRejectedValueOnce(new StudyError('transient', 'offline'))
      .mockResolvedValueOnce(material());
    const view = mount(() => useBlankPageCreation({ kind: 'project', projectId }));

    await test.act(async () => {
      await view.result.current.create('Blank page');
    });
    const input = api.create.mock.calls[0]![0];

    test.expect(input).toMatchObject({
      projectId,
      title: 'Blank page',
      document: { blocks: [{ text: '' }] }
    });
    test.expect(input).not.toHaveProperty('noteId');
    await test.act(async () => {
      await view.result.current.create('A changed title');
    });
    test.expect(api.create.mock.calls[1]![0]).toEqual(input);
    await settle();
    test.expect(view.result.current.error).toBeUndefined();
  }
);
