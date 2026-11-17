import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'dictation consumers cannot bypass the shared recording and RPC wrappers',
  async ({ expect, assert }) => {
    const diagnostics = await lintRule(
      { assert },
      'dictation-boundary',
      {
        'apps/client/src/features/notes/raw.ts': `import {rpc as api} from '@study/contracts/react'; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/alias.ts': `import {rpc} from '@study/contracts/react'; const {voice: speech} = rpc; speech.transcribe.useMutation();`,
        'apps/client/src/features/notes/mic.ts': `const media = navigator.mediaDevices; media.getUserMedia({audio:true});`,
        'apps/client/src/pages/settings/raw.ts': `const Recorder = window.MediaRecorder; new Recorder(stream);`,
        'apps/client/src/features/notes/host.ts': `import {captureMicrophone as capture} from '#client/lib/host.ts'; capture({});`
      },
      true
    );

    expect(diagnostics).toHaveLength(5);
  }
);

test.unit.stable(
  'dictation wrappers and test adapters keep their native capabilities',
  async ({ expect, assert }) => {
    expect(
      await lintRule(
        { assert },
        'dictation-boundary',
        {
          'apps/client/src/features/voice/button.tsx': `import {rpc} from '@study/contracts/react'; rpc.voice.transcribe.call({});`,
          'apps/client/src/lib/effect/microphone.ts': `navigator.mediaDevices.getUserMedia({audio:true}); new MediaRecorder(stream);`,
          'apps/client/src/lib/host.ts': `export {captureMicrophone} from './effect/native.ts';`,
          'apps/client/src/features/notes/wrapped.tsx': `import {DictationButton} from '#client/features/voice/index.ts';`,
          'apps/client/src/features/notes/other.ts': `const rpc = {voice: {transcribe(){}}}; rpc.voice.transcribe();`,
          'apps/client/src/features/notes/raw.test.ts': `navigator.mediaDevices.getUserMedia({audio:true});`
        },
        true
      )
    ).toStrictEqual([]);
  }
);

test.unit.stable(
  'namespace imports and the native barrel cannot bypass dictation ownership',
  async ({ expect, assert }) => {
    const diagnostics = await lintRule(
      { assert },
      'dictation-boundary',
      {
        'apps/client/src/features/notes/namespace.ts': `import * as host from '#client/lib/host.ts'; host.captureMicrophone({});`,
        'apps/client/src/features/notes/native.ts': `import {captureMicrophone} from '#client/lib/effect/native.ts'; captureMicrophone({});`,
        'apps/client/src/features/notes/rpc.ts': `import * as contracts from '@study/contracts/react'; contracts.rpc.voice.transcribe.call({});`
      },
      true
    );

    expect(diagnostics).toHaveLength(3);
  }
);
