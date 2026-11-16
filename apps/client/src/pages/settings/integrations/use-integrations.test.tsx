import { integrationImportIdSchema } from '@study/contracts';
import type { integrationImportSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import { IntegrationsSettings } from './index';
import { useIntegrations } from './use-integrations';

function createApi(mock: test.Mock) {
  return {
    imports: mock.fn(),
    providers: mock.fn(),
    projects: mock.fn(),
    start: mock.fn(),
    cancel: mock.fn(),
    preview: mock.fn()
  };
}

let api: ReturnType<typeof createApi>;

test.unit.beforeEach(({ mock }) => {
  api = createApi(mock);
});

function fixture({ rpcTestTransport }: Pick<test.unit.Context, 'rpcTestTransport'>) {
  return rpcTestTransport(async (tag, input) => {
    if (tag === 'integrations.imports') return api.imports();

    if (tag === 'integrations.providers') return api.providers();

    if (tag === 'projects.projects') return api.projects();

    if (tag === 'integrations.startImport') return api.start(input);

    if (tag === 'integrations.cancelImport') return api.cancel(input);

    if (tag === 'integrations.previewImport') return api.preview(input);

    throw new Error(tag);
  });
}

function previewState(): typeof integrationImportSchema.Type {
  return {
    id: Schema.decodeUnknownSync(integrationImportIdSchema)('00000000-0000-4000-8000-000000000001'),
    providerId: 'obsidian',
    sourceKey: 'Biology',
    status: 'preview',
    attempt: 0,
    projectId: null,
    errorKind: null,
    warnings: [],
    items: [
      { key: 'A.md', title: 'A', status: 'pending', noteId: null, errorKind: null },
      { key: 'B.md', title: 'B', status: 'pending', noteId: null, errorKind: null }
    ]
  };
}

test.unit.stable(
  'retains the reviewed import identity and exclusions when a start response is lost',
  async ({ renderHook, waitFor, expect, act, rpcTestTransport }) => {
    const state = previewState();

    api.imports.mockResolvedValue([state]);
    api.providers.mockResolvedValue([{ id: 'obsidian', capabilities: ['import'] }]);
    api.projects.mockResolvedValue({ items: [], next: null });
    api.start.mockRejectedValue(new Error('Response lost'));
    const client = fixture({ rpcTestTransport });
    const { result, unmount } = renderHook(useIntegrations, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <client.wrapper>{children}</client.wrapper>
      )
    });

    try {
      await waitFor(() => expect(result.current.imports.isSuccess).toBe(true));
      act(() => {
        result.current.setSelected(state.id);
        result.current.setExcluded(['B.md']);
      });
      act(() => result.current.act(state, 'start'));
      await waitFor(() => expect(result.current.action.isError).toBe(true));
      expect(result.current.current?.id).toBe(state.id);
      expect(result.current.excluded).toEqual(['B.md']);
      expect(api.start).toHaveBeenCalledWith({
        id: state.id,
        excludedKeys: ['B.md'],
        projectId: undefined
      });
      expect(api.preview).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  }
);

test.unit.stable.for([
  { attempt: 0, resumable: false },
  { attempt: 1, resumable: true }
])(
  'only offers resume for a confirmed cancelled import, attempt $attempt',
  async ({ attempt, resumable }, { render, fireEvent, screen, expect, rpcTestTransport }) => {
    const state = { ...previewState(), status: 'cancelled' as const, attempt };

    api.imports.mockResolvedValue([state]);
    api.providers.mockResolvedValue([{ id: 'obsidian', capabilities: ['import'] }]);
    api.projects.mockResolvedValue({ items: [], next: null });
    const client = fixture({ rpcTestTransport });
    const view = render(
      <client.wrapper>
        <IntegrationsSettings />
      </client.wrapper>
    );

    try {
      fireEvent.click(await screen.findByRole('button', { name: /^Biology/ }));
      await screen.findByRole('heading', { name: 'Biology' });
      expect(screen.queryByRole('button', { name: 'Resume import' }) !== null).toBe(resumable);
      expect(
        screen.queryByText(
          'Completed notes are kept. Resume this import to continue the remaining notes.'
        ) !== null
      ).toBe(resumable);
    } finally {
      view.unmount();
    }
  }
);
