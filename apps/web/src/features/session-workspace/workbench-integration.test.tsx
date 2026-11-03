import { sessionIdSchema } from '@study/contracts/ids';
import { createManualDocumentSchema } from '@study/contracts/materials/editing';
import { materialDetailSchema } from '@study/contracts/materials/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { material } from '../material-library/test/support';
import { SessionDocumentPanel } from './session-document-panel';
import { SessionWorkbench } from './workbench';

const rpc = vi.hoisted(() => ({
  create: vi.fn(),
  material: vi.fn(),
  materials: vi.fn(),
  thread: vi.fn(),
  post: vi.fn()
}));

vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));
vi.mock('../../lib/study-client/request', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'materials.createManualDocument': rpc.create,
      'materials.material': rpc.material,
      'materials.materials': rpc.materials,
      'conversations.thread': rpc.thread,
      'conversations.postMessage': rpc.post
    })
}));
// These controls exercise unrelated selection and capture workflows.
vi.mock('./context-actions', () => ({ SessionContextActions: () => null }));
vi.mock('./composer', () => ({ Composer: () => null }));

const sessionId = sessionIdSchema.make(12n);

const clients: QueryClient[] = [];

let created: ReturnType<typeof material> | undefined;

function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);

  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  created = undefined;
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockImplementation(async () => ({
    items: created ? [created] : [],
    nextCursor: null
  }));
  rpc.material.mockImplementation(async ({ id }: { id: bigint }) =>
    created?.id === id ? created : material(id)
  );
  rpc.create.mockImplementation(async (input: typeof createManualDocumentSchema.Type) => {
    const base = material(52n);
    const version = {
      ...base.version,
      creator: 'user',
      kind: 'document',
      content: { kind: 'document', ...input.document }
    };

    created = Schema.decodeUnknownSync(materialDetailSchema)({
      ...base,
      title: input.title,
      kind: 'document',
      version,
      latestPublishedVersion: version
    });

    return created;
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it('New document persists an empty attachment, adds its card, and opens its editable tab', async () => {
  mount(<SessionWorkbench id={sessionId} onDelete={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'SessionNewDocument' }));
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
  const input = rpc.create.mock.calls[0]![0];

  expect(Schema.decodeUnknownSync(createManualDocumentSchema)(input)).toEqual(input);
  expect(input).toMatchObject({
    sessionId,
    title: 'SessionNewPage',
    createKey: expect.any(String)
  });
  expect(input.document.blocks.every((block: { text: string }) => block.text === '')).toBe(true);
  expect(rpc.post).not.toHaveBeenCalled();
  expect(await screen.findByRole('tab', { name: 'SessionNewPage' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(await screen.findByRole('textbox', { name: 'SessionPageEditor' })).toHaveAttribute(
    'contenteditable',
    'true'
  );
  const history = screen.getByRole('region', { name: 'SessionNotebook' });

  expect(await within(history).findByRole('button', { name: /SessionNewPage/ })).toBeVisible();
});

function ImportedPanel() {
  const [id, setId] = useState(material().id);

  return (
    <SessionDocumentPanel sessionId={sessionId} materialId={id} onOpen={(next) => setId(next.id)} />
  );
}

it('Edit a copy retains the exact imported version and opens the new authored document', async () => {
  mount(<ImportedPanel />);
  const original = material();
  const reader = await screen.findByRole('textbox', { name: 'SessionPageEditor' });

  expect(reader).toHaveAttribute('contenteditable', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'DocumentEditCopy' }));
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
  const input = rpc.create.mock.calls[0]![0];

  expect(input).toMatchObject({
    sessionId,
    title: original.title,
    inputVersionId: original.version.id,
    createKey: expect.any(String)
  });
  expect(input.document.blocks[0]).toMatchObject({
    anchor: { type: 'authored' },
    text: 'Current extraction 41'
  });
  expect(input.document.blocks[0].id).not.toBe('b0');
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'SessionPageEditor' })).toHaveAttribute(
      'contenteditable',
      'true'
    )
  );
  expect(screen.queryByRole('button', { name: 'DocumentEditCopy' })).toBeNull();
  expect(rpc.post).not.toHaveBeenCalled();
});
