import type { WrittenExamInput } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useEffect, useRef } from 'react';

import { useNativeAction } from '#client/lib/effect/native.ts';

export type TrackExamRequest = (controller: AbortController | undefined) => void;

/** Opening and follow-up requests share the dialog's cancellation lifecycle. */
export function useWrittenExamRequest(track: TrackExamRequest) {
  const active = useRef<AbortController | undefined>(undefined);
  const action = useNativeAction(
    ({ input, signal }: { input: WrittenExamInput; signal: AbortSignal }) =>
      rpc.materials.writtenExam.call(input, { signal })
  );

  useEffect(() => () => active.current?.abort(), []);

  const run = async (input: WrittenExamInput) => {
    if (active.current) return undefined;

    const controller = new AbortController();

    active.current = controller;
    track(controller);
    action.reset();

    try {
      const result = await action.mutateAsync({ input, signal: controller.signal });

      return controller.signal.aborted ? undefined : result;
    } catch {
      return undefined;
    } finally {
      active.current = undefined;
      track(undefined);
    }
  };

  return { ...action, run, busy: () => active.current !== undefined };
}
