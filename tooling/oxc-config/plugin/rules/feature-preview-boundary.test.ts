import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

function lint(source: string, path = 'apps/landing/src/components/previews/Example.tsx') {
  return lintRule('feature-preview-boundary', { [path]: source }, true);
}

testStable(
  'fixture entry renders actual feature components instead of parallel preview controls',
  () => {
    const path = 'apps/web/src/feature-previews/index.tsx';

    expect(lint(`export const Preview = () => <button>Send</button>;`, path)).toHaveLength(2);
    expect(
      lint(
        `import { QuizQuestion as Question } from '../features/quiz/components/quiz-question'; export const Preview = () => <Question />;`,
        path
      )
    ).toHaveLength(0);
    expect(
      lint(
        `import { Button as Action } from '@study/ui/button'; import { QuizQuestion } from '../features/quiz/components/quiz-question'; export const Preview = () => <><QuizQuestion /><Action>Send</Action></>;`,
        path
      )
    ).toHaveLength(1);
    expect(
      lint(`const QuizQuestion = Local; export const Preview = () => <QuizQuestion />;`, path)
    ).toHaveLength(1);
  }
);

testStable(
  'canonical fixture previews cannot import production hooks or transport even through loader edges',
  () => {
    for (const source of [
      `import { useChat } from '../features/chat/hooks/use-chat';`,
      `export { client } from '../platform/rpc/client';`,
      `const load = import('@study/server/client');`,
      `const load = import('@tanstack/react-query');`,
      `import { usePreferences } from '#web/lib/study-client/workspace-preferences.queries';`,
      `import { useQuiz } from '../features/practice/use-quiz';`
    ])
      expect(lint(source, 'apps/web/src/feature-previews/example.tsx')).toHaveLength(1);

    expect(
      lint(
        `import { ChatMessage } from '../features/chat/components/chat-message';`,
        'apps/web/src/feature-previews/example.tsx'
      )
    ).toHaveLength(0);
  }
);

testStable('preview fixtures reject direct network access and permit injected feature data', () => {
  expect(
    lint(
      `fetch('/api'); new WebSocket('ws://localhost');`,
      'apps/web/src/feature-previews/example.tsx'
    )
  ).toHaveLength(2);
  expect(
    lint(`const data = { messages: [] };`, 'apps/web/src/feature-previews/example.tsx')
  ).toHaveLength(0);
});

testStable('narrative animations and documentation prose stay outside preview enforcement', () => {
  expect(
    lint(
      `export const Notebook = () => <button style={{color: 'red'}}>Turn page</button>;`,
      'apps/landing/src/components/Notebook.tsx'
    )
  ).toHaveLength(0);
});
