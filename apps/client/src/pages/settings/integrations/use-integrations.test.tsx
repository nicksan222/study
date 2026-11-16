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

test.beforeEach(({ mock }) => {
  api = createApi(mock);
});

function fixture() {
  return test.rpcTestTransport(async (tag, input) => {
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

test.stable(
  'retains the reviewed import identity and exclusions when a start response is lost',
  async () => {
    const state = previewState();

    api.imports.mockResolvedValue([state]);
    api.providers.mockResolvedValue([{ id: 'obsidian', capabilities: ['import'] }]);
    api.projects.mockResolvedValue({ items: [], next: null });
    api.start.mockRejectedValue(new Error('Response lost'));
    const client = fixture();
    const { result, unmount } = test.renderHook(useIntegrations, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <client.wrapper>{children}</client.wrapper>
      )
    });

    try {
      await test.waitFor(() => test.expect(result.current.imports.isSuccess).toBe(true));
      test.act(() => {
        result.current.setSelected(state.id);
        result.current.setExcluded(['B.md']);
      });
      test.act(() => result.current.act(state, 'start'));
      await test.waitFor(() => test.expect(result.current.action.isError).toBe(true));
      test.expect(result.current.current?.id).toBe(state.id);
      test.expect(result.current.excluded).toEqual(['B.md']);
      test.expect(api.start).toHaveBeenCalledWith({
        id: state.id,
        excludedKeys: ['B.md'],
        projectId: undefined
      });
      test.expect(api.preview).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  }
);

test.stable.each([
  { attempt: 0, resumable: false },
  { attempt: 1, resumable: true }
])(
  'only offers resume for a confirmed cancelled import, attempt $attempt',
  async ({ attempt, resumable }) => {
    const state = { ...previewState(), status: 'cancelled' as const, attempt };

    api.imports.mockResolvedValue([state]);
    api.providers.mockResolvedValue([{ id: 'obsidian', capabilities: ['import'] }]);
    api.projects.mockResolvedValue({ items: [], next: null });
    const client = fixture();
    const view = test.render(
      <client.wrapper>
        <IntegrationsSettings />
      </client.wrapper>
    );

    try {
      test.fireEvent.click(await test.screen.findByRole('button', { name: /^Biology/ }));
      await test.screen.findByRole('heading', { name: 'Biology' });
      test
        .expect(test.screen.queryByRole('button', { name: 'Resume import' }) !== null)
        .toBe(resumable);
      test
        .expect(
          test.screen.queryByText(
            'Completed notes are kept. Resume this import to continue the remaining notes.'
          ) !== null
        )
        .toBe(resumable);
    } finally {
      view.unmount();
    }
  }
);
