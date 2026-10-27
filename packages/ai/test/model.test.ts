import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createStudyAgents } from '../src/index.ts';
import { createChatGptModel } from '../src/providers/chatgpt/model.ts';
import { AuthManager } from '../src/providers/chatgpt/session.ts';

test('Responses adapter retries 401 with rotated OAuth token and consumes SSE', async () => {
  const bodies: Record<string, unknown>[] = [];
  const headers: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) chunks.push(chunk as Buffer);

    if (req.url === '/api/accounts/oauth/token') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          access_token: 'renewed',
          refresh_token: 'rotated',
          expires_in: 3600
        })
      );

      return;
    }

    headers.push(req.headers.authorization ?? '');
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));

    if (headers.length === 1) {
      res.writeHead(401).end();

      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });

    for (const event of [
      {
        type: 'response.created',
        response: { id: 'resp', created_at: 1, model: 'gpt-test' }
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'item' }
      },
      { type: 'response.output_text.delta', item_id: 'item', delta: 'Biology' },
      { type: 'response.completed', response: {} }
    ])
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    res.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'first' },
      { accessToken: 'original', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'gpt-test',
      baseUrl: base
    });
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });
    const result = await agents.title.generate({ prompt: 'Cells' });

    assert.equal(result.text, 'Biology');
    assert.deepEqual(headers, ['Bearer original', 'Bearer renewed']);
    assert.equal(bodies[1].stream, true);
    assert.equal(bodies[1].store, false);
    assert.match(String(bodies[1].instructions), /study session/i);
    assert.ok(Array.isArray(bodies[1].input));
  } finally {
    await auth.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a truncated Responses stream fails instead of returning partial text', async () => {
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'token', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async () =>
        new Response(
          `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'a', delta: 'partial' })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
    });
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });

    await assert.rejects(agents.title.generate({ prompt: 'x' }));
  } finally {
    await auth.dispose();
  }
});

test('cancellation while waiting for shared refresh does not cancel another caller', async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {},
    fetch: async () => {
      entered();
      await gate;

      return Response.json({ access_token: 'fresh', expires_in: 3600 });
    }
  });

  try {
    await auth.replace({
      subject: 'u',
      clientId: 'c',
      sharing: true,
      refreshToken: 'r'
    });
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async () => new Response('', { status: 503 })
    });
    const controller = new AbortController();
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });
    const first = agents.title.generate({
      prompt: 'x',
      abortSignal: controller.signal
    });
    const rejected = assert.rejects(first);

    await started;
    const other = auth.token();

    controller.abort();
    await Promise.race([
      rejected,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error('cancellation blocked')), 100)
      )
    ]);
    release();
    assert.equal(await other, 'fresh');
  } finally {
    release();
    await auth.dispose();
  }
});

test('real Responses SSE tool calls execute retrieval and send the result back', async () => {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) chunks.push(chunk as Buffer);

    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const call = {
      type: 'function_call',
      id: 'item1',
      call_id: 'call1',
      name: 'sources',
      arguments: JSON.stringify({ query: 'cell' })
    };
    const events =
      bodies.length === 1
        ? [
            {
              type: 'response.created',
              response: { id: 'resp1', created_at: 1, model: 'test' }
            },
            { type: 'response.output_item.added', output_index: 0, item: call },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: { ...call, status: 'completed' }
            },
            { type: 'response.completed', response: {} }
          ]
        : [
            {
              type: 'response.created',
              response: { id: 'resp2', created_at: 1, model: 'test' }
            },
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', id: 'item2' }
            },
            {
              type: 'response.output_text.delta',
              item_id: 'item2',
              delta: 'The cell uses energy [1].'
            },
            { type: 'response.completed', response: {} }
          ];

    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);

    res.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    const queries: string[] = [];
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
    const agents = createStudyAgents({
      model,
      capabilities: {
        searchSources: async (query) => {
          queries.push(query);

          return [{ id: '1', name: 'notes', text: 'Cells use energy' }];
        }
      }
    });
    const answer = await agents.reply.generate({ prompt: 'Explain cells' });

    assert.equal(answer.text, 'The cell uses energy [1].');
    assert.deepEqual(queries, ['cell']);
    assert.match(JSON.stringify(bodies[1].input), /Cells use energy/);
  } finally {
    await auth.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP and SSE failures never expose provider response secrets', async () => {
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'private-access-token', expiresIn: 3600 }
    );
    const responses = [
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'bad', message: 'secret-http-message' }
          }),
          { status: 500 }
        ),
      () =>
        new Response(
          `data: ${JSON.stringify({ type: 'error', code: 'bad', message: 'secret-sse-message' })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
    ];

    for (const response of responses) {
      const model = createChatGptModel({
        auth,
        modelId: 'test',
        fetch: async () => response()
      });
      const agents = createStudyAgents({
        model,
        capabilities: { searchSources: async () => [] }
      });

      await assert.rejects(agents.title.generate({ prompt: 'x' }), (error) => {
        const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));

        return (
          !serialized.includes('secret-http-message') &&
          !serialized.includes('secret-sse-message') &&
          !serialized.includes('private-access-token')
        );
      });
    }
  } finally {
    await auth.dispose();
  }
});

test('ChatGPT messages carry image and PDF bytes through Responses', async () => {
  let body: Record<string, unknown> = {};
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async (_url, init) => {
        body = JSON.parse(init?.body as string);
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: 'read' },
          { type: 'response.completed', response: {} }
        ];

        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });
    const result = await agents.reply.generate({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'read' },
            {
              type: 'image',
              image: new Uint8Array([1, 2, 3]),
              mediaType: 'image/png'
            },
            {
              type: 'file',
              data: new Uint8Array([4, 5, 6]),
              mediaType: 'application/pdf',
              filename: 'notes.pdf'
            }
          ]
        }
      ]
    });

    assert.equal(result.text, 'read');
    const wire = JSON.stringify(body.input);

    assert.match(wire, /input_image/);
    assert.match(wire, /input_file/);
    assert.match(wire, /notes.pdf/);
  } finally {
    await auth.dispose();
  }
});

test('adapter strips SDK APICallError details and causes', async () => {
  const { APICallError } = await import('@ai-sdk/provider');
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async () => {
        throw new APICallError({
          message: 'secret-message',
          url: 'https://secret-url',
          requestBodyValues: { secret: 'secret-body' },
          responseBody: 'secret-response'
        });
      }
    });
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });

    await assert.rejects(agents.title.generate({ prompt: 'x' }), (error) => {
      const serial = JSON.stringify(error, Object.getOwnPropertyNames(error));

      return !serial.includes('secret-');
    });
  } finally {
    await auth.dispose();
  }
});

test('question and material requests use strict object-root Responses schemas', async () => {
  const { generateMaterial } = await import('../src/index.ts');
  const outputs = [
    {
      gist: 'Cells',
      question: 'What is a cell?',
      choices: ['A', 'B', 'C'],
      answer: 1,
      explanation: 'B',
      cites: [1]
    },
    {
      gist: 'Cells',
      question: 'Describe a cell',
      reference: 'A cell is a unit',
      cites: [1]
    },
    { cards: [{ front: 'A', back: 'B', cites: [1] }] },
    { mermaid: 'flowchart TD\nA[Cell] --> B[Energy]' }
  ];
  const bodies: Record<string, unknown>[] = [];
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init?.body as string));
        const text = JSON.stringify(outputs[bodies.length - 1]);
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: text },
          { type: 'response.completed', response: {} }
        ];

        return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });

    await agents.question('choice', 'question');
    await agents.question('open', 'question');
    await generateMaterial(agents, 'cards', { kind: 'flashcards' });
    await generateMaterial(agents, 'diagram', { kind: 'diagram' });

    for (const body of bodies) {
      const format = (
        body.text as {
          format: {
            type: string;
            strict: boolean;
            schema: Record<string, unknown>;
          };
        }
      ).format;

      assert.equal(format.type, 'json_schema');
      assert.equal(format.strict, true);
      assert.equal(format.schema.type, 'object');
      assert.doesNotMatch(
        JSON.stringify(format.schema),
        /"oneOf"|"anyOf"|"minLength"|"maxLength"|"minItems"|"maxItems"/
      );
    }
  } finally {
    await auth.dispose();
  }
});

test('reply hooks never save after a failed or truncated SSE stream', async () => {
  const { streamReply } = await import('../src/index.ts');
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );

    for (const end of [
      '',
      `data: ${JSON.stringify({ type: 'response.failed', sequence_number: 1, response: { error: { code: 'failure', message: 'private' } } })}\n\n`
    ]) {
      const events = [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'm' }
        },
        { type: 'response.output_text.delta', item_id: 'm', delta: 'partial' }
      ];
      const model = createChatGptModel({
        auth,
        modelId: 'test',
        fetch: async () =>
          new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + end, {
            headers: { 'content-type': 'text/event-stream' }
          })
      });
      const agents = createStudyAgents({
        model,
        capabilities: { searchSources: async () => [] }
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
    }
  } finally {
    await auth.dispose();
  }
});

test('streamReply preserves conversation history, image and PDF input', async () => {
  const { streamReply } = await import('../src/index.ts');
  let body: Record<string, unknown> = {};
  const auth = new AuthManager({
    issuer: 'https://auth.test',
    saveRefresh: async () => {}
  });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async (_url, init) => {
        body = JSON.parse(init?.body as string);
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: 'read' },
          { type: 'response.completed', response: {} }
        ];

        return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });
    const agents = createStudyAgents({
      model,
      capabilities: { searchSources: async () => [] }
    });
    const messages = [
      { role: 'user' as const, content: 'Earlier request' },
      { role: 'assistant' as const, content: 'Earlier answer' },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Read these' },
          {
            type: 'image' as const,
            image: new Uint8Array([1, 2, 3]),
            mediaType: 'image/png'
          },
          {
            type: 'file' as const,
            data: new Uint8Array([4, 5, 6]),
            mediaType: 'application/pdf',
            filename: 'notes.pdf'
          }
        ]
      }
    ];
    const saved: string[] = [];

    assert.equal(
      await streamReply(agents, messages, {
        save: (text) => {
          saved.push(text);
        }
      }),
      'read'
    );
    assert.deepEqual(saved, ['read']);
    const input = JSON.stringify(body.input);

    for (const expected of [
      'Earlier request',
      'Earlier answer',
      'input_image',
      'input_file',
      'notes.pdf'
    ])
      assert.ok(input.includes(expected));
  } finally {
    await auth.dispose();
  }
});
