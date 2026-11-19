export function forwardAbort(source: AbortSignal, request: AbortController) {
  const abort = () => request.abort(source.reason);

  if (source.aborted) abort();
  else source.addEventListener('abort', abort, { once: true });

  return () => source.removeEventListener('abort', abort);
}
