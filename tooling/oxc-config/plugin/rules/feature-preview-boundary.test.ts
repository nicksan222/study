import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint(
  { assert: assertions }: Pick<test.Context, 'assert'>,
  source: string,
  path = 'apps/landing/src/components/previews/Example.tsx'
) {
  const assert: test.Assert = assertions;

  return await lintRule({ assert }, 'feature-preview-boundary', { [path]: source }, true);
}

test.stable(
  'fixture entry renders actual feature components instead of parallel preview controls',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const path = 'apps/client/src/feature-previews/index.tsx';

    expect(
      await lint({ assert }, `export const Preview = () => <button>Send</button>;`, path)
    ).toHaveLength(2);
    expect(
      await lint(
        { assert },
        `import { QuizQuestion as Question } from '../features/quiz/components/quiz-question'; export const Preview = () => <Question />;`,
        path
      )
    ).toHaveLength(0);
    expect(
      await lint(
        { assert },
        `import { Button as Action } from '@study/ui'; import { QuizQuestion } from '../features/quiz/components/quiz-question'; export const Preview = () => <><QuizQuestion /><Action>Send</Action></>;`,
        path
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `const QuizQuestion = Local; export const Preview = () => <QuizQuestion />;`,
        path
      )
    ).toHaveLength(1);
  }
);

test.stable(
  'canonical fixture previews cannot import production hooks or transport even through loader edges',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    for (const source of [
      `import { useChat } from '../features/chat/hooks/use-chat';`,
      `export { client } from '../platform/rpc/client';`,
      `const load = import('@study/server/client');`,
      `const load = import('@study/contracts/react');`,
      `import { usePreferences } from '#client/lib/study-client/workspace-preferences.queries';`,
      `import { useQuiz } from '../features/practice/use-quiz';`
    ])
      expect(
        await lint({ assert }, source, 'apps/client/src/feature-previews/example.tsx')
      ).toHaveLength(1);

    expect(
      await lint(
        { assert },
        `import { ChatMessage } from '../features/chat/components/chat-message';`,
        'apps/client/src/feature-previews/example.tsx'
      )
    ).toHaveLength(0);
  }
);

test.stable(
  'preview fixtures reject direct network access and permit injected feature data',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `fetch('/api'); new WebSocket('ws://localhost');`,
        'apps/client/src/feature-previews/example.tsx'
      )
    ).toHaveLength(2);
    expect(
      await lint(
        { assert },
        `const data = { messages: [] };`,
        'apps/client/src/feature-previews/example.tsx'
      )
    ).toHaveLength(0);
  }
);

test.stable(
  'narrative animations and documentation prose stay outside preview enforcement',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `export const Notebook = () => <button style={{color: 'red'}}>Turn page</button>;`,
        'apps/landing/src/components/Notebook.tsx'
      )
    ).toHaveLength(0);
  }
);
