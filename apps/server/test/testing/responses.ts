/** @file Builds complete Responses API wire events for controlled native provider peers. */
interface FunctionCall {
  type: string;
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

function completed(output: readonly unknown[]) {
  return {
    type: 'response.completed',
    response: {
      id: 'response',
      created_at: 1,
      model: 'fixture',
      status: 'completed',
      output,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
    }
  };
}

export function textResponseEvents(text: string) {
  const message = {
    type: 'message',
    id: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }]
  };

  return [
    { type: 'response.created', response: { id: 'response', created_at: 1, model: 'fixture' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...message, status: 'in_progress', content: [] }
    },
    {
      type: 'response.output_text.delta',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      delta: text
    },
    { type: 'response.output_item.done', output_index: 0, item: message },
    completed([message])
  ];
}

export function toolResponseEvents(call: FunctionCall) {
  const item = { ...call, status: 'completed' };

  return [
    { type: 'response.created', response: { id: 'response', created_at: 1, model: 'fixture' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...call, status: 'in_progress' }
    },
    { type: 'response.output_item.done', output_index: 0, item },
    completed([item])
  ];
}
