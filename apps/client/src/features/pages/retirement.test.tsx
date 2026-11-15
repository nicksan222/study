import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { usePageRetirement } from './retirement.queries';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

for (const uncertain of [false, true])
  testStable(
    `retirement ${uncertain ? 'keeps unknown outcome explicit without replay' : 'completes only after the canonical mutation receipt'}`,
    async () => {
      const page = authoredPage(10n, 'Private body', 101n);
      const preview = {
        pageId: page.id,
        token: 'exact-preview',
        versionIds: [page.version!.id],
        blockedVersionIds: [],
        semantics: 'retire_bodies_retain_identities' as const
      };
      const remove = vi
        .fn()
        .mockImplementation(() =>
          uncertain
            ? Promise.reject(new StudyError('transient', 'Lost response'))
            : Promise.resolve(undefined)
        );
      const harness = rpcHandlersTransport({
        'pages.previewDeletion': async () => preview,
        'pages.delete': remove
      });
      const view = renderHook(() => usePageRetirement(page), { wrapper: harness.wrapper });

      act(() => view.result.current.open('deletion'));
      await waitFor(() => expect(view.result.current.preview?.token).toBe(preview.token));
      await act(async () => {
        await view.result.current.retire.mutateAsync().catch(() => undefined);
      });
      expect(remove).toHaveBeenCalledExactlyOnceWith({ pageId: page.id, token: preview.token });

      if (uncertain) {
        expect(view.result.current.retire.isError).toBe(true);
        expect(view.result.current.mode).toBe('deletion');
      } else expect(view.result.current.mode).toBeUndefined();

      view.unmount();
    }
  );
