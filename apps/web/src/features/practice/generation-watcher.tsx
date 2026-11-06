import { toastManager } from '@study/ui/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import { quizGenerationOptions } from './quiz-generation.queries';

export function GenerationWatcher({ id, settled }: { id: string; settled: (id: string) => void }) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const state = useQuery(quizGenerationOptions(id));
  const notified = useRef(false);
  const ready = state.data?.resultVersionId != null;
  const failed = state.data?.errorKind != null;

  useEffect(() => {
    if (notified.current || (!ready && !failed)) return;

    notified.current = true;
    void cache.invalidateQueries({ queryKey: ['materials'] });
    void cache.invalidateQueries({ queryKey: ['library', 'practice'] });
    toastManager.add({
      title: t(ready ? 'QuizGenerateReady' : 'QuizGenerateError'),
      type: ready ? 'success' : 'error'
    });
    settled(id);
  }, [cache, ready, failed, t, id, settled]);

  return <AgentProgress correlationId={id} />;
}
