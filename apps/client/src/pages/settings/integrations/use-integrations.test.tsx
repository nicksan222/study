import { integrationImportIdSchema } from '@study/contracts/integrations/schemas';
import type { integrationImportSchema } from '@study/contracts/integrations/schemas';
import { testStable } from '@study/testing/vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { IntegrationsSettings } from './index';
import { useIntegrations } from './use-integrations';

const api = vi.hoisted(() => ({
  imports: vi.fn(),
  providers: vi.fn(),
  projects: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  preview: vi.fn()
}));

function fixture() {
  return settingsTransport(async (tag, input) => {
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

testStable(
  'retains the reviewed import identity and exclusions when a start response is lost',
  async () => {
    const state = previewState();

    api.imports.mockResolvedValue([state]);
    api.providers.mockResolvedValue([{ id: 'obsidian', capabilities: ['import'] }]);
    api.projects.mockResolvedValue({ items: [], next: null });
    api.start.mockRejectedValue(new Error('Response lost'));
    const client = fixture();
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

testStable.each([
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
