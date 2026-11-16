import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint(source: string, path = 'apps/landing/src/components/previews/Example.tsx') {
  return await lintRule('feature-preview-boundary', { [path]: source }, true);
}

test.stable(
  'fixture entry renders actual feature components instead of parallel preview controls',
  async () => {
    const path = 'apps/client/src/feature-previews/index.tsx';

    test
      .expect(await lint(`export const Preview = () => <button>Send</button>;`, path))
      .toHaveLength(2);
    test
      .expect(
        await lint(
          `import { QuizQuestion as Question } from '../features/quiz/components/quiz-question'; export const Preview = () => <Question />;`,
          path
        )
      )
      .toHaveLength(0);
    test
      .expect(
        await lint(
          `import { Button as Action } from '@study/ui'; import { QuizQuestion } from '../features/quiz/components/quiz-question'; export const Preview = () => <><QuizQuestion /><Action>Send</Action></>;`,
          path
        )
      )
      .toHaveLength(1);
    test
      .expect(
        await lint(
          `const QuizQuestion = Local; export const Preview = () => <QuizQuestion />;`,
          path
        )
      )
      .toHaveLength(1);
  }
);

test.stable(
  'canonical fixture previews cannot import production hooks or transport even through loader edges',
  async () => {
    for (const source of [
      `import { useChat } from '../features/chat/hooks/use-chat';`,
      `export { client } from '../platform/rpc/client';`,
      `const load = import('@study/server/client');`,
      `const load = import('@study/contracts/react');`,
      `import { usePreferences } from '#client/lib/study-client/workspace-preferences.queries';`,
      `import { useQuiz } from '../features/practice/use-quiz';`
    ])
      test
        .expect(await lint(source, 'apps/client/src/feature-previews/example.tsx'))
        .toHaveLength(1);

    test
      .expect(
        await lint(
          `import { ChatMessage } from '../features/chat/components/chat-message';`,
          'apps/client/src/feature-previews/example.tsx'
        )
      )
      .toHaveLength(0);
  }
);

test.stable(
  'preview fixtures reject direct network access and permit injected feature data',
  async () => {
    test
      .expect(
        await lint(
          `fetch('/api'); new WebSocket('ws://localhost');`,
          'apps/client/src/feature-previews/example.tsx'
        )
      )
      .toHaveLength(2);
    test
      .expect(
        await lint(`const data = { messages: [] };`, 'apps/client/src/feature-previews/example.tsx')
      )
      .toHaveLength(0);
  }
);

test.stable(
  'narrative animations and documentation prose stay outside preview enforcement',
  async () => {
    test
      .expect(
        await lint(
          `export const Notebook = () => <button style={{color: 'red'}}>Turn page</button>;`,
          'apps/landing/src/components/Notebook.tsx'
        )
      )
      .toHaveLength(0);
  }
);
