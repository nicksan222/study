/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keeps reactive endpoint consumption separate from transport execution and protocol │
 * │ schemas.                                                                                 │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Production client modules importing raw RPC/runtime operations outside lib/effect and    │
 * │ explicit composition exceptions. Consumers use @study/contracts/react; protocol          │
 * │ contracts stay React-free except react.ts/react-state.ts. Only value module edges are    │
 * │ checked; endpoint constructors own the reactive contract's type enforcement.             │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/client/src/features/library/library.queries.ts                                 │
 * │   import { rpc } from '@study/contracts/react';                                          │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/client/src/features/library/library.queries.ts                                 │
 * │   import { makeStudyClient } from '@study/server/client';                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { webFile, webTarget } from '../web-files.ts';

/** Import ownership only; endpoint constructors enforce the reactive contract types. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const current = webFile(context.filename);
    const composition = current?.startsWith('lib/effect/');
    const protocol = reactFreeProtocol(filename);

    return moduleEdges(context, (node, source, typeOnly) => {
      if (source === null) return;

      if (typeOnly) return;

      if (protocol && importsReact(source))
        context.report({
          node,
          message:
            'Keep protocol schemas and endpoint definitions React-free; React bindings belong to the optional react entry point.'
        });

      if (!current || composition) return;

      const target = webTarget(context.filename, source);

      if (ownsTransport(current, target)) return;

      if (importsTransport(source, target))
        context.report({
          node,
          message:
            'Consume endpoints from @study/contracts/react; transport execution belongs to application runtime composition.'
        });
    });
  }
});

function importsReact(source: string) {
  return (
    /^(?:react|@effect\/atom-react)(?:\/|$)/.test(source) ||
    /(?:^|\/)react(?:-state)?(?:\.[cm]?[jt]sx?)?$/.test(source)
  );
}

function importsTransport(source: string, target: string | undefined) {
  return (
    /^(?:@study\/server\/client|effect\/(?:unstable\/)?rpc)(?:\/|$)/.test(source) ||
    (target?.startsWith('lib/effect/') && target !== 'lib/effect/native') ||
    target === 'lib/study-client/operations'
  );
}

function ownsTransport(current: string, target: string | undefined) {
  return (
    (current === 'app/providers.tsx' && target === 'lib/effect/rpc') ||
    (current === 'lib/study-client/repeat-request.ts' && target === 'lib/effect/runtime')
  );
}

function reactFreeProtocol(filename: string) {
  return (
    filename.includes('/packages/contracts/src/') &&
    !/\/packages\/contracts\/src\/react(?:-state)?\.ts$/.test(filename)
  );
}
