import type { WrittenExamInput, WrittenExamResult } from '@study/contracts';
import { useLocation, useMatches, useRouter } from '@tanstack/react-router';
import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ExamOpening = Pick<WrittenExamInput, 'projectId' | 'inputs'> &
  Omit<Extract<WrittenExamResult, { kind: 'opening' }>, 'kind'>;

type ExamSession = {
  opening: ExamOpening;
  origin: string;
  restoreFocus: () => void;
};

const OpeningContext = createContext<{
  session: ExamSession | undefined;
  setSession: (session: ExamSession | undefined) => void;
} | null>(null);

/** Hands off an opening to the exam page without storing it in browser history. */
export function WrittenExamProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<ExamSession>();
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const project = String(session?.opening.projectId);
  const isExam = useMatches({
    select: (matches) => {
      const page = matches.at(-1);

      return page?.routeId === '/practice/written-exam' && page.search.project === project;
    }
  });
  const wasActive = useRef(false);

  useEffect(
    () =>
      router.history.subscribe(({ location }) => {
        if (wasActive.current) return;

        // Back can leave the new history entry before its route has rendered.
        if (router.parseLocation(location).pathname !== '/practice/written-exam')
          setSession(undefined);
      }),
    [router]
  );

  useLayoutEffect(() => {
    const left = wasActive.current && !isExam;

    wasActive.current = isExam;

    if (left && session) {
      if (href === session.origin) session.restoreFocus();

      setSession(undefined);
    }
  }, [href, isExam, session]);

  return <OpeningContext value={{ session, setSession }}>{children}</OpeningContext>;
}

export function useWrittenExamOpening() {
  const context = useContext(OpeningContext);

  if (!context) throw new Error('Missing written exam provider');

  return context;
}
