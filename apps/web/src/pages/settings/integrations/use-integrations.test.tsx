import { integrationImportIdSchema } from '@study/contracts/integrations/schemas';
import type { integrationImportSchema } from '@study/contracts/integrations/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import { useIntegrations } from './use-integrations';

const api = vi.hoisted(() => ({
  imports: vi.fn(),
  providers: vi.fn(),
  projects: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  preview: vi.fn()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'integrations.imports': api.imports,
      'integrations.providers': api.providers,
      'projects.projects': api.projects,
      'integrations.startImport': api.start,
      'integrations.cancelImport': api.cancel,
      'integrations.previewImport': api.preview
    })
}));

testStable(
  'retains the reviewed import identity and exclusions when a start response is lost',
  async () => {
    const state: typeof integrationImportSchema.Type = {
      id: Schema.decodeUnknownSync(integrationImportIdSchema)(
        '00000000-0000-4000-8000-000000000001'
      ),
      providerId: 'obsidian',
      sourceKey: 'Biology',
      status: 'preview',
      attempt: 0,
      projectId: null,
      errorKind: null,
      warnings: [],
      items: [
        { key: 'A.md', title: 'A', status: 'pending', sessionId: null, errorKind: null },
        { key: 'B.md', title: 'B', status: 'pending', sessionId: null, errorKind: null }
      ]
    };

    api.imports.mockResolvedValue([state]);
    api.providers.mockResolvedValue([{ id: 'obsidian', capabilities: ['import'] }]);
    api.projects.mockReturnValueOnce({ items: [], next: null });
    api.start.mockRejectedValue(new Error('Response lost'));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    const { result, unmount } = renderHook(useIntegrations, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
      client.clear();
    }
  }
);
