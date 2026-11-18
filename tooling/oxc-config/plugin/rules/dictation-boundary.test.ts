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
        'apps/client/src/features/notes/host.ts': `import {captureMicrophone as capture} from '#client/lib/host.ts'; capture({});`
      },
      true
    );

    expect(diagnostics).toHaveLength(8);
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
        'apps/client/src/features/notes/destructured-rpc.ts': `import * as contracts from '@study/contracts/react'; const {rpc: api} = contracts; api.voice.transcribe.call({});`,
        'apps/client/src/features/notes/deep-rpc.ts': `import * as contracts from '@study/contracts/react'; const {rpc: {voice: {transcribe: recognize}}} = contracts; recognize.call({});`,
        'apps/client/src/features/notes/rpc.ts': `import * as contracts from '@study/contracts/react'; contracts.rpc.voice.transcribe.call({});`
      },
      true
    );

    expect(diagnostics).toHaveLength(5);
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
          'apps/client/src/features/notes/local-global.ts': `const window = {navigator: {mediaDevices: {getUserMedia(){}}}}; const {navigator: {mediaDevices}} = window; mediaDevices.getUserMedia();`
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
