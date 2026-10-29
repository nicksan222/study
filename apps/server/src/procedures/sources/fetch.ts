import { StudyError } from '#server/shared/errors/index';

import { checkAbort, DEFAULT_MAX_BYTES } from './readers/common.ts';

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetch?: typeof fetch;
}

export interface FetchedPage {
  url: string;
  bytes: Uint8Array;
  mime: string;
  name: string;
}

export async function fetchPage(address: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const limit = options.maxBytes ?? DEFAULT_MAX_BYTES,
    redirects = options.maxRedirects ?? 5,
    timeout = options.timeoutMs ?? 15000;

  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(redirects) ||
    redirects < 0 ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0
  )
    throw new StudyError('invalid_input', 'Invalid fetch limits');

  let url: URL;

  try {
    url = new URL(address);
  } catch (cause) {
    throw new StudyError('invalid_input', 'Invalid URL', { cause });
  }

  const timed = AbortSignal.timeout(timeout),
    signal = options.signal ? AbortSignal.any([options.signal, timed]) : timed;
  const request = options.fetch ?? fetch;

  try {
    for (let count = 0; ; count++) {
      checkAbort(options.signal);

      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new StudyError(
          'invalid_input',
          'Only HTTP and HTTPS URLs without credentials are supported'
        );

      const response = await request(url, {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html,application/xhtml+xml' }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        await response.body?.cancel();

        if (!location || count >= redirects)
          throw new StudyError('invalid_input', 'Invalid or excessive redirects');

        url = new URL(location, url);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();

        throw new StudyError(
          response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'transient'
              : 'invalid_input',
          `Page request failed with HTTP ${response.status}`
        );
      }

      const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

      if (mime && mime !== 'text/html' && mime !== 'application/xhtml+xml') {
        await response.body?.cancel();

        throw new StudyError('unsupported', 'The URL is not an HTML page');
      }

      const declared = Number(response.headers.get('content-length'));

      if (Number.isFinite(declared) && declared > limit) {
        await response.body?.cancel();

        throw new StudyError('invalid_input', 'Page exceeds the size limit');
      }

      const reader = response.body?.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;

      if (reader)
        try {
          for (;;) {
            const { done, value } = await reader.read();

            if (done) break;

            size += value.byteLength;

            if (size > limit) throw new StudyError('invalid_input', 'Page exceeds the size limit');

            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});

          throw error;
        } finally {
          reader.releaseLock();
        }

      const bytes = new Uint8Array(size);
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return { url: url.href, bytes, mime: 'text/html', name: url.hostname };
    }
  } catch (error) {
    checkAbort(options.signal);

    if (timed.aborted)
      throw new StudyError('transient', 'Page request timed out', {
        cause: error
      });

    if (error instanceof StudyError) throw error;

    throw new StudyError('transient', 'Page request failed', { cause: error });
  }
}
