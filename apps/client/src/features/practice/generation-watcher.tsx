import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui';
import { useEffect, useRef } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export function GenerationWatcher({ id, settled }: { id: string; settled: (id: string) => void }) {
  const { t } = useI18n();
  const state = rpc.materials.materialGeneration.useQuery({ requestId: id });
  const notified = useRef(false);
  const ready = state.data?.resultVersionId != null;
  const cancelled = state.data?.cancelled;
  const failed = state.data?.errorKind != null;

  useEffect(() => {
    if (notified.current || (!ready && !failed && !cancelled)) return;

    notified.current = true;

    if (!cancelled)
      toastManager.add({
        title: t(ready ? 'QuizGenerateReady' : 'QuizGenerateError'),
        type: ready ? 'success' : 'error'
      });

    settled(id);
  }, [ready, failed, cancelled, t, id, settled]);

  return null;
}
