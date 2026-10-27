import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';

import { createStudyAgents } from '../src/index.ts';

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined }
};

function answer(
  content: LanguageModelV3GenerateResult['content'],
  reason: 'stop' | 'tool-calls' = 'stop'
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: { unified: reason, raw: undefined },
    usage,
    warnings: []
  };
}

test('ToolLoopAgent executes injected retrieval and validates structured output', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: [
      answer(
        [
          {
            type: 'tool-call',
            toolCallId: 'call1',
            toolName: 'sources',
            input: JSON.stringify({ query: 'mitochondria' })
          }
        ],
        'tool-calls'
      ),
      answer([
        {
          type: 'text',
          text: JSON.stringify({ verdict: 'correct', feedback: 'Well done.' })
        }
      ])
    ]
  });
  const queries: string[] = [];
  const agents = createStudyAgents({
    model,
    capabilities: {
      searchSources: async (query) => {
        queries.push(query);

        return [{ id: '1', name: 'lecture', text: 'Energy' }];
      }
    }
  });
  const result = await agents.grade.generate({ prompt: 'Grade this answer.' });

  assert.deepEqual(queries, ['mitochondria']);
  assert.deepEqual(result.output, {
    verdict: 'correct',
    feedback: 'Well done.'
  });
  assert.equal(model.doGenerateCalls.length, 2);
});

test('ToolLoopAgent propagates cancellation to the model', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      assert.equal(abortSignal?.aborted, true);

      throw abortSignal?.reason;
    }
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const controller = new AbortController();

  controller.abort(new Error('cancelled'));
  await assert.rejects(agents.title.generate({ prompt: 'hello', abortSignal: controller.signal }));
});

test('diagram validation retries with feedback and saves only valid material', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doGenerate: [
      answer([
        {
          type: 'text',
          text: JSON.stringify({ type: 'diagram', mermaid: 'bad diagram' })
        }
      ]),
      answer([
        {
          type: 'text',
          text: JSON.stringify({
            type: 'diagram',
            mermaid: 'flowchart TD\nA[Cell] --> B[Energy]'
          })
        }
      ])
    ]
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const saved: unknown[] = [];
  const result = await generateMaterial(agents, 'diagram', {
    kind: 'diagram',
    save: async (value) => {
      saved.push(value);
    }
  });

  assert.equal(result.type, 'diagram');
  assert.equal(saved.length, 1);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /flowchart needs fixing/i);
});

test('diagram generation accepts standard Mermaid subgraphs and preserves citations', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const mermaid = 'flowchart TD\nsubgraph Biology\nA["Cell [1]"] --> B["Energy [2]"]\nend';
  const model = new MockLanguageModelV3({
    doGenerate: answer([{ type: 'text', text: JSON.stringify({ mermaid }) }])
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const saved: unknown[] = [];
  const result = await generateMaterial(agents, 'diagram', {
    kind: 'diagram',
    maxAttempts: 1,
    save: async (value) => {
      saved.push(value);
    }
  });

  assert.deepEqual(result, { type: 'diagram', mermaid });
  assert.deepEqual(saved, [result]);
});

test('diagram generation never saves invalid Mermaid after retries are exhausted', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doGenerate: answer([
      {
        type: 'text',
        text: JSON.stringify({ mermaid: 'flowchart TD\nA[broken' })
      }
    ])
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const saved: unknown[] = [];

  await assert.rejects(
    generateMaterial(agents, 'diagram', {
      kind: 'diagram',
      maxAttempts: 2,
      save: async (value) => {
        saved.push(value);
      }
    }),
    /Diagram could not be validated/
  );
  assert.deepEqual(saved, []);
  assert.equal(model.doGenerateCalls.length, 2);
});

test('diagram validation can be cancelled without saving material', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doGenerate: answer([
      {
        type: 'text',
        text: JSON.stringify({
          mermaid: 'flowchart TD\nA[Cell] --> B[Energy]'
        })
      }
    ])
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const saved: unknown[] = [];

  await assert.rejects(
    generateMaterial(agents, 'diagram', {
      kind: 'diagram',
      signal: AbortSignal.timeout(50),
      save: async (value) => {
        saved.push(value);
      }
    }),
    { name: 'TimeoutError' }
  );
  assert.deepEqual(saved, []);
});

test('diagram validation keeps non-flowcharts out of saved material', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doGenerate: answer([
      {
        type: 'text',
        text: JSON.stringify({
          mermaid: 'sequenceDiagram\nAlice->>Bob: Hello'
        })
      }
    ])
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const saved: unknown[] = [];

  await assert.rejects(
    generateMaterial(agents, 'diagram', {
      kind: 'diagram',
      maxAttempts: 1,
      save: async (value) => {
        saved.push(value);
      }
    }),
    /Diagram could not be validated/
  );
  assert.deepEqual(saved, []);
});

test('flashcard material is saved through the injected hook', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doGenerate: answer([
      {
        type: 'text',
        text: JSON.stringify({
          type: 'flashcards',
          cards: [{ front: 'A', back: 'B', cites: [1] }]
        })
      }
    ])
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const saved: unknown[] = [];
  const result = await generateMaterial(agents, 'cards', {
    kind: 'flashcards',
    save: async (value) => {
      saved.push(value);
    }
  });

  assert.deepEqual(saved, [result]);
});

test('stream reply forwards deltas and saves the completed text', async () => {
  const { streamReply } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't' });
          controller.enqueue({ type: 'text-delta', id: 't', delta: 'Hello' });
          controller.enqueue({ type: 'text-delta', id: 't', delta: ' there' });
          controller.enqueue({ type: 'text-end', id: 't' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage
          });
          controller.close();
        }
      })
    })
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });
  const deltas: string[] = [],
    saved: string[] = [];
  const result = await streamReply(agents, 'hi', {
    onTextDelta: (delta) => {
      deltas.push(delta);
    },
    save: (text) => {
      saved.push(text);
    }
  });

  assert.equal(result, 'Hello there');
  assert.deepEqual(deltas, ['Hello', ' there']);
  assert.deepEqual(saved, [result]);
});

test('choice answer must index an actual choice', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: answer([
      {
        type: 'text',
        text: JSON.stringify({
          gist: 'g',
          question: 'q',
          choices: ['a', 'b', 'c'],
          answer: 4,
          explanation: 'e',
          cites: [1]
        })
      }
    ])
  });
  const agents = createStudyAgents({
    model,
    capabilities: { searchSources: async () => [] }
  });

  await assert.rejects(agents.question('choice', 'q'), /Invalid multiple-choice/);
});

test('stream reply never saves partial text after a tool fails', async () => {
  const { streamReply } = await import('../src/index.ts');
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't' });
          controller.enqueue({ type: 'text-delta', id: 't', delta: 'partial' });
          controller.enqueue({ type: 'text-end', id: 't' });
          controller.enqueue({
            type: 'tool-call',
            toolCallId: 'call',
            toolName: 'sources',
            input: JSON.stringify({ query: 'x' })
          });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage
          });
          controller.close();
        }
      })
    })
  });
  const agents = createStudyAgents({
    model,
    capabilities: {
      searchSources: async () => {
        throw new Error('source failure');
      }
    }
  });
  const saved: string[] = [];

  await assert.rejects(
    streamReply(agents, 'x', {
      save: (text) => {
        saved.push(text);
      }
    })
  );
  assert.deepEqual(saved, []);
});
