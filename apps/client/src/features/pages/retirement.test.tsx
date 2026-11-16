import { StudyError } from '@study/contracts';
import { test } from '@study/testing';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './retirement.queries';

let authoredPage: typeof __MockType0.authoredPage;

let usePageRetirement: typeof __MockType1.usePageRetirement;

let navigate: ReturnType<typeof createMockState>['navigate'];

function createMockState(mock: test.Mock) {
  return {
    navigate: mock.fn()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  navigate = __mockState.navigate;

  mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./retirement.queries');

  usePageRetirement = __mockModule1.usePageRetirement;
});

for (const uncertain of [false, true])
  test.stable(
    `retirement ${uncertain ? 'keeps unknown outcome explicit without replay' : 'completes only after the canonical mutation receipt'}`,
    async ({ vi, rpcHandlersTransport, renderHook, act, waitFor, expect }) => {
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
