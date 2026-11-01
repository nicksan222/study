/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs Mermaid parsing in the isolated worker used by diagram validation. It         │
 * │ initializes a script-free DOM environment and returns either a parse issue or success to │
 * │ the parent thread.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Initializes jsdom and Mermaid inside a worker, parses workerData, and posts either a   │
 * │   parse issue or success through parentPort.                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ validator.ts creates this worker with Mermaid source as workerData and owns termination; │
 * │ the worker does not access application services.                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { parentPort, workerData } from 'node:worker_threads';

import { JSDOM } from 'jsdom';

const dom = new JSDOM('');

// DOMPurify binds to this window when Mermaid is imported. No scripts execute.
Object.defineProperty(globalThis, 'window', { value: dom.window });

const { default: mermaid } = await import('mermaid');

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

try {
  const parsed = await mermaid.parse(workerData);

  parentPort?.postMessage(
    parsed.diagramType === 'flowchart-v2' || parsed.diagramType === 'graph'
      ? undefined
      : 'The flowchart needs fixing: produce a Mermaid flowchart TD or LR.'
  );
} catch (error) {
  parentPort?.postMessage(
    `The flowchart needs fixing: ${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  dom.window.close();
}
