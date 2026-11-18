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
        'apps/client/src/features/notes/nested.ts': `import {rpc} from '@study/contracts/react'; const {voice: {transcribe}} = rpc; transcribe.call({});`,
        'apps/client/src/features/notes/nested-alias.ts': `import {rpc as api} from '@study/contracts/react'; const {voice: {transcribe: recognize}} = api; recognize.call({});`,
        'apps/client/src/features/notes/nested-default.ts': `import {rpc} from '@study/contracts/react'; const {voice: {transcribe = fallback}} = rpc; transcribe.call({});`,
        'apps/client/src/features/notes/extracted-call.ts': `import {rpc} from '@study/contracts/react'; const {voice: {transcribe: {call: recognize}}} = rpc; recognize({});`,
        'apps/client/src/features/notes/host.ts': `import {captureMicrophone as capture} from '#client/lib/host.ts'; capture({});`
      },
      true
    );

    expect(diagnostics).toHaveLength(9);
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
          'apps/client/src/features/notes/capture-type.ts': `import type {captureMicrophone} from '#client/lib/host.ts';`,
          'apps/client/src/features/notes/capture-specifier-type.ts': `import {type captureMicrophone} from '#client/lib/effect/native.ts';`,
          'apps/client/src/features/notes/local.ts': `const rpc = {voice: {transcribe: {call(){}}}}; const {voice: {transcribe}} = rpc; transcribe.call({});`,
          'apps/client/src/features/notes/local-call.ts': `const rpc = {voice: {transcribe: {call(){}}}}; const {voice: {transcribe: {call: recognize}}} = rpc; recognize({});`,
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
        'apps/client/src/features/notes/direct.ts': `import {captureMicrophone} from '#client/lib/effect/microphone.ts'; captureMicrophone({});`,
        'apps/client/src/features/notes/direct-namespace.ts': `import * as native from '#client/lib/effect/microphone.ts'; native.captureMicrophone({});`,
        'apps/client/src/features/notes/destructured-rpc.ts': `import * as contracts from '@study/contracts/react'; const {rpc: api} = contracts; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/deep-rpc.ts': `import * as contracts from '@study/contracts/react'; const {rpc: {voice: {transcribe: recognize}}} = contracts; recognize.call({});`,
        'apps/client/src/features/notes/rpc.ts': `import * as contracts from '@study/contracts/react'; contracts.rpc.voice.transcribe.call({});`
      },
      true
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort()).toEqual([
      'deep-rpc.ts',
      'destructured-rpc.ts',
      'direct-namespace.ts',
      'direct.ts',
      'namespace.ts',
      'native.ts',
      'rpc.ts'
    ]);
  }
);

test.unit.stable(
  'nested browser globals cannot bypass the shared dictation wrapper',
  async ({ expect, assert }) => {
    const diagnostics = await lintRule(
      { assert },
      'dictation-boundary',
      {
        'apps/client/src/features/notes/media.ts': `const {navigator: {mediaDevices}} = window; mediaDevices.getUserMedia({audio:true});`,
        'apps/client/src/features/notes/recorder.ts': `const {window: {MediaRecorder: Recorder}} = globalThis; new Recorder(stream);`,
        'apps/client/src/features/notes/default.ts': `const {navigator: {mediaDevices: media = fallback}} = window; media.getUserMedia({audio:true});`,
        'apps/client/src/features/notes/self.ts': `const {self: {MediaRecorder: Recorder}} = window; new Recorder(stream);`
      },
      true
    );

    expect(diagnostics).toHaveLength(4);
    expect(
      await lintRule(
        { assert },
        'dictation-boundary',
        {
          'apps/client/src/features/notes/local-global.ts': `const window = {navigator: {mediaDevices: {getUserMedia(){}}}}; const {navigator: {mediaDevices}} = window; mediaDevices.getUserMedia();`,
          'apps/client/src/features/notes/dotted-destructure.ts': `const {'mediaDevices.getUserMedia': read} = navigator; read?.();`,
          'apps/client/src/features/notes/dotted-member.ts': `navigator['mediaDevices.getUserMedia']?.();`,
          'apps/client/src/features/notes/dotted-rpc.ts': `import {rpc} from '@study/contracts/react'; const {'voice.transcribe': transmit} = rpc; transmit.call({});`
        },
        true
      )
    ).toEqual([]);
  }
);

test.unit.stable(
  'type assertions cannot hide voice capability aliases',
  async ({ expect, assert }) => {
    const diagnostics = await lintRule(
      { assert },
      'dictation-boundary',
      {
        'apps/client/src/features/notes/asserted.ts': `import {rpc} from '@study/contracts/react'; const api = rpc as typeof rpc; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/satisfies.ts': `import {rpc} from '@study/contracts/react'; const api = rpc satisfies typeof rpc; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/non-null.ts': `import {rpc} from '@study/contracts/react'; const api = rpc!; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/type-assertion.ts': `import {rpc} from '@study/contracts/react'; const api = <typeof rpc>rpc; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/asserted-media.ts': `const media = navigator.mediaDevices as typeof navigator.mediaDevices; media.getUserMedia({audio:true});`,
        'apps/client/src/features/notes/asserted-recorder.ts': `const Record = (globalThis.MediaRecorder satisfies typeof MediaRecorder)!; new Record(stream);`,
        'apps/client/src/features/notes/nested-assertion.ts': `import {rpc} from '@study/contracts/react'; const {voice: {transcribe: {call: recognize}}} = (rpc as typeof rpc)!; recognize({});`
      },
      true
    );

    expect(diagnostics).toHaveLength(7);
    expect(
      await lintRule(
        { assert },
        'dictation-boundary',
        {
          'apps/client/src/features/notes/asserted-local.ts': `const local = {voice: {transcribe: {call(){}}}}; const api = local as typeof local; api.voice.transcribe.call({});`
        },
        true
      )
    ).toEqual([]);
  }
);

test.unit.stable(
  'non-owner barrels cannot re-export raw microphone capabilities',
  async ({ expect, assert }) => {
    const diagnostics = await lintRule(
      { assert },
      'dictation-boundary',
      {
        'apps/client/src/features/notes/barrel.ts': `export {captureMicrophone} from '#client/lib/host.ts';`,
        'apps/client/src/features/notes/alias.ts': `export {captureMicrophone as record} from '#client/lib/host.ts';`,
        'apps/client/src/features/notes/wildcard.ts': `export * from '#client/lib/host.ts';`,
        'apps/client/src/features/notes/native-export.ts': `export * as native from '#client/lib/effect/native.ts';`,
        'apps/client/src/features/notes/relative-export.ts': `export {captureMicrophone} from '../../lib/host.ts';`
      },
      true
    );

    expect(diagnostics).toHaveLength(5);
    expect(
      await lintRule(
        { assert },
        'dictation-boundary',
        {
          'apps/client/src/lib/host.ts': `export {captureMicrophone} from './effect/native.ts';`,
          'apps/client/src/features/voice/index.ts': `export * from '#client/lib/host.ts';`,
          'apps/client/src/features/notes/types.ts': `export type * from '#client/lib/host.ts';`,
          'apps/client/src/features/notes/availability.ts': `export {microphoneAvailable} from '#client/lib/host.ts';`,
          'apps/client/src/features/notes/local-export.ts': `export {captureMicrophone} from './local.ts';`
        },
        true
      )
    ).toEqual([]);
  }
);

test.unit.stable(
  'voice capabilities cannot escape through a dynamic import or a re-export',
  async ({ expect, assert }) => {
    const diagnostics = await lintRule(
      { assert },
      'dictation-boundary',
      {
        'apps/client/src/features/notes/dynamic-capture.ts':
          "const {captureMicrophone} = await import('#client/lib/host.ts'); void captureMicrophone({});",
        'apps/client/src/features/notes/dynamic-rpc.ts':
          "const {rpc} = await import('@study/contracts/react'); rpc.voice.transcribe.call({});",
        'apps/client/src/features/notes/exports-rpc.ts':
          "export {rpc as voiceClient} from '@study/contracts/react';",
        'apps/client/src/features/notes/dynamic-template.ts':
          'const host = await import(`#client/lib/host.ts`); void host.captureMicrophone({});',
        'apps/client/src/features/notes/exports-namespace.ts':
          "import * as contracts from '@study/contracts/react'; export {contracts};",
        'apps/client/src/features/notes/exports-capture.ts':
          "import * as host from '#client/lib/host.ts'; const {captureMicrophone: raw} = host; export {raw};",
        'apps/client/src/features/notes/exports-available.ts':
          "import * as host from '#client/lib/host.ts'; const {microphoneAvailable} = host; export {microphoneAvailable};",
        'apps/client/src/features/notes/exports-voice.ts':
          "import {rpc} from '@study/contracts/react'; const {voice} = rpc; export {voice};",
        'apps/client/src/features/notes/frame.ts':
          'const { 0: firstFrame } = window.frames; firstFrame.focus();'
      },
      true
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort()).toEqual([
      'dynamic-capture.ts',
      'dynamic-rpc.ts',
      'dynamic-template.ts',
      'exports-capture.ts',
      'exports-namespace.ts',
      'exports-rpc.ts',
      'exports-voice.ts'
    ]);
  }
);
