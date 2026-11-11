/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs Mermaid parsing in the isolated worker used by diagram validation.            │
 * │ Initializes a script-free DOM and returns a parse issue or success to its parent.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Initializes jsdom and Mermaid and parses requested diagram source.                     │
 * │ - Posts the resulting parse issue or success to the parent worker.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The validator owns worker creation, messaging, and termination.                          │
 * │ This worker does not access application services.                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

// Register before loading Mermaid so early parent messages are retained.
self.onmessage = async (event: MessageEvent<string>) => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('');

  Object.defineProperty(globalThis, 'window', { value: dom.window });

  try {
    const { default: mermaid } = await import('mermaid');

    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const parsed = await mermaid.parse(event.data);

    self.postMessage(
      parsed.diagramType === 'flowchart-v2' || parsed.diagramType === 'graph'
        ? undefined
        : 'The flowchart needs fixing: produce a Mermaid flowchart TD or LR.'
    );
  } catch (error) {
    self.postMessage(
      `The flowchart needs fixing: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    dom.window.close();
  }
};
