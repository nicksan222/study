import type { MaterialVersionId } from '@study/contracts/ids';
import { Effect } from 'effect';

import { runRequest } from '../effect/runtime';
import { request } from './request';

export async function downloadOriginal(id: MaterialVersionId) {
  const result = await request((client) => client['materials.materialVersionExport']({ id }));
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(result.bytes)], { type: result.source.mime })
  );
  await runRequest(
    Effect.acquireUseRelease(
      Effect.succeed(url),
      (href) =>
        Effect.sync(() => {
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.download = result.source.name;
          anchor.click();
        }).pipe(Effect.andThen(Effect.sleep('1 second'))),
      (href) => Effect.sync(() => URL.revokeObjectURL(href))
    )
  );
}
