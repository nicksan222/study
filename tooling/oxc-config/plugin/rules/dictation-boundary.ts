/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reserves microphone capture and voice RPC for the shared dictation wrappers.       │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Editors bypassing capture ownership, cancellation, insertion recovery or test adapters.  │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │ import { DictationTextarea } from '#client/features/voice/index.ts';                     │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │ // apps/client/src/features/notes/editor.tsx                                             │
 * │ rpc.voice.transcribe.call({ samples });                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import {
  constantDeclarator,
  destructuredPath,
  imported,
  lexicalResolver
} from '../lexical-bindings.ts';
import { webFile, webTarget } from '../web-files.ts';
import { nativeGlobal } from './native-global.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current || current.startsWith('features/voice/')) return {};

    const capture = current === 'lib/effect/microphone.ts';
    const bindings = effectBindings(context);
    const rpc = lexicalResolver(
      (node, seen) => {
        if (imported(context, node, /^@study\/contracts\/react$/, 'rpc')) return 'rpc';

        const definition = bindings.definition(node);
        const namespace = namespaceCapability(context, definition);

        if (namespace) return namespace;

        if (!constantDeclarator(definition)) return null;

        if (definition.id.type === 'Identifier') return rpc(definition.init, seen);

        if (definition.id.type !== 'ObjectPattern') return null;

        const base = rpc(definition.init, seen);
        const names = destructuredPath(definition.id, node.name, []);

        return base && names
          ? [base, ...names].join('.').replace(/^contracts\.rpc(?=\.|$)/, 'rpc')
          : null;
      },
      (node, seen) => {
        const base = rpc(node.object, seen);
        const name =
          !node.computed || node.property.type === 'Literal' ? propertyName(node.property) : null;

        if (base === 'contracts' && name === 'rpc') return 'rpc';

        return base && name ? `${base}.${name}` : null;
      }
    );
    const report = (node: any) =>
      context.report({
        node,
        message:
          'Use DictationButton or DictationTextarea from the voice feature; capture and voice RPC belong to their shared wrapper.'
      });

    return {
      MemberExpression(node) {
        const path = rpc(node);

        if (
          path === 'host.captureMicrophone' ||
          path === 'rpc.voice' ||
          (path?.startsWith('rpc.voice.') && node.object.type === 'Identifier')
        )
          report(node);
      },
      ImportDeclaration(node) {
        const target = webTarget(context.filename, node.source.value);
        const ownsHost = current === 'lib/host.ts' || current.startsWith('lib/effect/');

        if (ownsHost || !['lib/host', 'lib/effect/native'].includes(target ?? '')) return;

        const raw = node.specifiers.some(
          (item: any) => propertyName(item.imported) === 'captureMicrophone'
        );

        if (raw) report(node);
      },
      CallExpression(node) {
        if (capture) return;

        if (node.callee.type === 'Identifier' && rpc(node.callee) === 'host.captureMicrophone')
          report(node);

        const name = nativeGlobal(bindings, node.callee)?.replace(
          /^(?:(?:window|globalThis|self)\.)+/,
          ''
        );

        if (name === 'navigator.mediaDevices.getUserMedia') report(node);
      },
      NewExpression(node) {
        if (capture) return;

        const name = nativeGlobal(bindings, node.callee)?.replace(
          /^(?:(?:window|globalThis|self)\.)+/,
          ''
        );

        if (name === 'MediaRecorder') report(node);
      }
    };
  }
});

function namespaceCapability(context: any, definition: any) {
  if (definition?.type !== 'ImportNamespaceSpecifier') return null;

  const source = definition.parent.source.value;

  if (source === '@study/contracts/react') return 'contracts';

  const target = webTarget(context.filename, source);

  return ['lib/host', 'lib/effect/native'].includes(target ?? '') ? 'host' : null;
}
