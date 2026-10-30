import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3StreamPart as ImportedLanguageModelV3StreamPart } from '@ai-sdk/provider';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult
} from '@ai-sdk/provider';
import { StudyError } from '@study/contracts/errors';
import type { Clock } from 'effect';

import type { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { streamingFetch } from '#server/platform/http/index';

export class ChatGptRequestError extends Error {
  readonly kind: 'auth' | 'rate_limited' | 'transient' | 'unsupported';

  constructor(kind: 'auth' | 'rate_limited' | 'transient' | 'unsupported') {
    super(`ChatGPT request failed (${kind})`);
    this.name = 'ChatGptRequestError';
    this.kind = kind;
  }
}

async function waitForToken(auth: AuthManager, signal?: AbortSignal | null): Promise<string> {
  if (!signal) return auth.token();

  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);

    signal.addEventListener('abort', abort, { once: true });
    auth
      .token()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));

    if (signal.aborted) abort();
  });
}

/** Verify a terminal Responses event without buffering the full answer. */
function requireTerminal(response: Response): Response {
  if (!response.body) throw new ChatGptRequestError('transient');

  const decoder = new TextDecoder();
  let line = '';
  let terminal = false;
  const check = (value: string) => {
    if (!value.startsWith('data:')) return;

    try {
      const event: unknown = JSON.parse(value.slice(5).trim());

      if (
        event !== null &&
        typeof event === 'object' &&
        'type' in event &&
        typeof event.type === 'string' &&
        ['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(
          event.type
        )
      )
        terminal = true;
    } catch {
      /* The SDK validates event data. */
    }
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        line += decoder.decode(chunk, { stream: true });

        if (line.length > 1024 * 1024) throw new ChatGptRequestError('transient');

        const lines = line.split('\n');

        line = lines.pop() ?? '';

        for (const item of lines) check(item.trimEnd());

        controller.enqueue(chunk);
      },
      flush() {
        line += decoder.decode();
        check(line.trimEnd());

        if (!terminal) throw new ChatGptRequestError('transient');
      }
    })
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

type RequestCheck = (signal: AbortSignal | undefined) => Promise<void>;

export interface ChatGptModel extends LanguageModelV3 {
  withRequestCheck(check: RequestCheck): ChatGptModel;
}

function supportsRequestCheck(model: LanguageModelV3): model is ChatGptModel {
  return 'withRequestCheck' in model && typeof model.withRequestCheck === 'function';
}

export function withRequestCheck(model: LanguageModelV3, check: RequestCheck): LanguageModelV3 {
  if (!supportsRequestCheck(model))
    throw new StudyError('unsupported', 'Model does not support request preflight');

  return model.withRequestCheck(check);
}

export interface ChatGptModelOptions {
  auth: AuthManager;
  modelId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  beforeRequest?: RequestCheck;
  clock?: Clock.Clock;
}

/** OpenAI Responses on the signed-in ChatGPT plan. */
export function createChatGptModel({
  auth,
  modelId,
  baseUrl = 'https://api.openai.com/v1',
  fetch: request = fetch,
  beforeRequest,
  clock = auth.clock
}: ChatGptModelOptions): ChatGptModel {
  if (!modelId) throw new Error('A ChatGPT model ID is required');

  const provider = createOpenAI({
    baseURL: baseUrl,
    apiKey: 'oauth',
    fetch: async (url, init) => {
      const signal = init?.signal;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw signal.reason;

        const token = await waitForToken(auth, signal);

        if (signal?.aborted) throw signal.reason;

        const headers = new Headers(init?.headers);

        headers.set('authorization', `Bearer ${token}`);
        headers.set('accept', 'text/event-stream');
        await beforeRequest?.(signal ?? undefined);

        if (signal?.aborted) throw signal.reason;

        const response = await streamingFetch(
          url,
          {
            ...init,
            headers,
            redirect: 'error'
          },
          { fetch: request, timeoutMs: 120_000, maxBytes: 32 * 1024 * 1024, clock }
        );

        if (response.status === 401 && attempt === 0) {
          await response.body?.cancel();
          auth.refused(token);
          continue;
        }

        if (response.ok) return requireTerminal(response);

        let code = '';

        try {
          const body = (await response.json()) as {
            error?: { code?: unknown };
          };

          if (typeof body?.error?.code === 'string') code = body.error.code;
        } catch {
          /* Body is intentionally discarded. */
        }

        const known = [
          'subscription_sharing_usage_limit_exceeded',
          'subscription_sharing_invalid_user',
          'subscription_sharing_user_not_eligible',
          'subscription_sharing_unsupported_capability'
        ].includes(code)
          ? code
          : 'request_failed';
        const kind =
          known === 'subscription_sharing_usage_limit_exceeded' || response.status === 429
            ? 'rate_limited'
            : known === 'subscription_sharing_unsupported_capability'
              ? 'unsupported'
              : [401, 403].includes(response.status) ||
                  known === 'subscription_sharing_invalid_user' ||
                  known === 'subscription_sharing_user_not_eligible'
                ? 'auth'
                : 'transient';

        throw new ChatGptRequestError(kind);
      }

      throw new Error('ChatGPT authorization failed');
    }
  });
  const inner = provider.responses(modelId);
  const prepare = (options: LanguageModelV3CallOptions): LanguageModelV3CallOptions => {
    const system = options.prompt
      .filter((item) => item.role === 'system')
      .map((item) => item.content)
      .join('\n\n');

    return {
      ...options,
      temperature: undefined,
      topP: undefined,
      maxOutputTokens: undefined,
      prompt: options.prompt.filter((item) => item.role !== 'system'),
      providerOptions: {
        ...options.providerOptions,
        openai: {
          ...options.providerOptions?.openai,
          instructions: system,
          store: false,
          systemMessageMode: 'remove'
        }
      }
    };
  };
  const doStream: LanguageModelV3['doStream'] = async (options) => {
    let result: Awaited<ReturnType<typeof inner.doStream>>;

    try {
      result = await inner.doStream(prepare(options));
    } catch (error) {
      if (options.abortSignal?.aborted) throw options.abortSignal.reason;

      if (error instanceof ChatGptRequestError || error instanceof StudyError) throw error;

      if (
        error &&
        typeof error === 'object' &&
        'cause' in error &&
        (error.cause instanceof ChatGptRequestError || error.cause instanceof StudyError)
      )
        throw error.cause;

      throw new ChatGptRequestError('transient');
    }

    const reader = result.stream.getReader();
    const stream = new ReadableStream<ImportedLanguageModelV3StreamPart>({
      async pull(controller) {
        try {
          const item = await reader.read();

          if (item.done) {
            controller.close();

            return;
          }

          if (
            item.value.type === 'finish' &&
            ['error', 'length', 'content-filter'].includes(item.value.finishReason.unified)
          ) {
            controller.error(new ChatGptRequestError('transient'));

            return;
          }

          controller.enqueue(
            item.value.type === 'error'
              ? { type: 'error', error: new ChatGptRequestError('transient') }
              : item.value
          );
        } catch {
          if (options.abortSignal?.aborted) controller.error(options.abortSignal.reason);
          else controller.error(new ChatGptRequestError('transient'));
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      }
    });

    return { ...result, stream };
  };

  return {
    specificationVersion: 'v3',
    provider: 'chatgpt',
    withRequestCheck: (check) =>
      createChatGptModel({
        auth,
        modelId,
        baseUrl,
        fetch: request,
        clock,
        beforeRequest: async (signal) => {
          await beforeRequest?.(signal);
          await check(signal);
        }
      }),
    modelId,
    supportedUrls: inner.supportedUrls,
    doStream,
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const streamed = await doStream(options);
      const content: LanguageModelV3Content[] = [];
      const text = new Map<string, { type: 'text' | 'reasoning'; text: string }>();
      let finish:
        | Extract<
            Awaited<ReturnType<typeof doStream>>['stream'] extends ReadableStream<infer T>
              ? T
              : never,
            { type: 'finish' }
          >
        | undefined;
      let warnings: LanguageModelV3GenerateResult['warnings'] = [];
      let metadata: LanguageModelV3GenerateResult['response'];

      for await (const part of streamed.stream) {
        if (part.type === 'stream-start') warnings = part.warnings;
        else if (part.type === 'response-metadata')
          metadata = {
            id: part.id,
            timestamp: part.timestamp,
            modelId: part.modelId
          };
        else if (part.type === 'text-start' || part.type === 'reasoning-start') {
          const item = {
            type: part.type === 'text-start' ? ('text' as const) : ('reasoning' as const),
            text: ''
          };

          text.set(part.id, item);
          content.push(item);
        } else if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
          const item = text.get(part.id);

          if (item) item.text += part.delta;
        } else if (
          part.type === 'tool-call' ||
          part.type === 'tool-result' ||
          part.type === 'tool-approval-request' ||
          part.type === 'file' ||
          part.type === 'source'
        )
          content.push(part);
        else if (part.type === 'error') throw new Error('ChatGPT stream failed');
        else if (part.type === 'finish') finish = part;
      }

      if (!finish || ['error', 'length', 'content-filter'].includes(finish.finishReason.unified))
        throw new Error('ChatGPT response incomplete or failed');

      return {
        content,
        finishReason: finish.finishReason,
        usage: finish.usage,
        providerMetadata: finish.providerMetadata,
        warnings,
        response: metadata
      };
    }
  };
}
