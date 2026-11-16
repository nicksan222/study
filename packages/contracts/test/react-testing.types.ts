// Compiled contract checks; these declarations are never executed.
import { Effect } from 'effect';

import { createRpcScenario } from '../src/react-testing.ts';

function scenarioContract() {
  const rpc = createRpcScenario();

  rpc.given({
    'settings.appSettings': { language: 1, appearance: 3, zoomPercent: 100, onboarded: true }
  });
  rpc.handle({ 'settings.saveAppSettings': () => Effect.succeed({}) });
  // @ts-expect-error endpoint names come from the canonical RPC group
  rpc.given({ 'notes.invented': [] });
  rpc.given({
    // @ts-expect-error snapshots preserve canonical settings literals
    'settings.appSettings': { language: 7, appearance: 3, zoomPercent: 100, onboarded: true }
  });
  // @ts-expect-error handler outputs preserve the endpoint's success schema
  rpc.handle({ 'notes.renameNote': () => 'saved' });
  rpc.handle({
    'settings.saveAppSettings': (input) => {
      // @ts-expect-error handler inputs preserve the endpoint's payload schema
      const language: string = input.language;

      void language;

      return {};
    }
  });
}

void scenarioContract;
