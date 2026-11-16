import { StudyError } from '@study/contracts';
import { test } from '@study/testing';

import { authoredPage } from '../document-editing/test-support';
import { usePageRetirement } from './retirement.queries';

const navigate = test.vi.fn();

test.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

for (const uncertain of [false, true])
  test.stable(
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
      const remove = test.vi
        .fn()
        .mockImplementation(() =>
          uncertain
            ? Promise.reject(new StudyError('transient', 'Lost response'))
            : Promise.resolve(undefined)
        );
      const harness = test.rpcHandlersTransport({
        'pages.previewDeletion': async () => preview,
        'pages.delete': remove
      });
      const view = test.renderHook(() => usePageRetirement(page), { wrapper: harness.wrapper });

      test.act(() => view.result.current.open('deletion'));
      await test.waitFor(() => test.expect(view.result.current.preview?.token).toBe(preview.token));
      await test.act(async () => {
        await view.result.current.retire.mutateAsync().catch(() => undefined);
      });
      test
        .expect(remove)
        .toHaveBeenCalledExactlyOnceWith({ pageId: page.id, token: preview.token });

      if (uncertain) {
        test.expect(view.result.current.retire.isError).toBe(true);
        test.expect(view.result.current.mode).toBe('deletion');
      } else test.expect(view.result.current.mode).toBeUndefined();

      view.unmount();
    }
  );
