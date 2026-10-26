import { fixtureHeaders } from "./files";
// Hints only invalidate queries; their contents never stand in for persisted state.
export async function subscribeRefresh(
  signal: AbortSignal,
  onRefresh: () => void,
) {
  while (!signal.aborted) {
    try {
      const response = await fetch("/rpc/events", {
        headers: fixtureHeaders(),
        signal,
      });
      if (!response.ok || !response.body) throw new Error(response.statusText);
      onRefresh();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (event.split("\n").some((line) => line.startsWith("data:")))
              onRefresh();
          }
        }
      } finally {
        await reader.cancel();
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 3000);
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
