import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

async function lint(source: string, path = 'apps/landing/src/components/previews/Example.tsx') {
  return await lintRule('feature-preview-boundary', { [path]: source }, true);
}

testStable(
  'fixture entry renders actual feature components instead of parallel preview controls',
  async () => {
    const path = 'apps/web/src/feature-previews/index.tsx';

    expect(await lint(`export const Preview = () => <button>Send</button>;`, path)).toHaveLength(2);
    expect(
      await lint(
        `import { QuizQuestion as Question } from '../features/quiz/components/quiz-question'; export const Preview = () => <Question />;`,
        path
      )
    ).toHaveLength(0);
    expect(
      await lint(
        `import { Button as Action } from '@study/ui/button'; import { QuizQuestion } from '../features/quiz/components/quiz-question'; export const Preview = () => <><QuizQuestion /><Action>Send</Action></>;`,
        path
      )
    ).toHaveLength(1);
    expect(
      await lint(`const QuizQuestion = Local; export const Preview = () => <QuizQuestion />;`, path)
    ).toHaveLength(1);
  }
);

testStable(
  'canonical fixture previews cannot import production hooks or transport even through loader edges',
  async () => {
    for (const source of [
      `import { useChat } from '../features/chat/hooks/use-chat';`,
      `export { client } from '../platform/rpc/client';`,
      `const load = import('@study/server/client');`,
      `const load = import('@tanstack/react-query');`,
      `import { usePreferences } from '#web/lib/study-client/workspace-preferences.queries';`,
      `import { useQuiz } from '../features/practice/use-quiz';`
    ])
      expect(await lint(source, 'apps/web/src/feature-previews/example.tsx')).toHaveLength(1);

    expect(
      await lint(
        `import { ChatMessage } from '../features/chat/components/chat-message';`,
        'apps/web/src/feature-previews/example.tsx'
      )
    ).toHaveLength(0);
  }
);

testStable(
  'preview fixtures reject direct network access and permit injected feature data',
  async () => {
    expect(
      await lint(
        `fetch('/api'); new WebSocket('ws://localhost');`,
        'apps/web/src/feature-previews/example.tsx'
      )
    ).toHaveLength(2);
    expect(
      await lint(`const data = { messages: [] };`, 'apps/web/src/feature-previews/example.tsx')
    ).toHaveLength(0);
  }
);

testStable(
  'narrative animations and documentation prose stay outside preview enforcement',
  async () => {
    expect(
      await lint(
        `export const Notebook = () => <button style={{color: 'red'}}>Turn page</button>;`,
        'apps/landing/src/components/Notebook.tsx'
      )
    ).toHaveLength(0);
  }
);
