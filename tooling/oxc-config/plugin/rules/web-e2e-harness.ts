import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import {
  binding,
  constantAliasValue,
  destructuredBinding,
  enterNode,
  memberName
} from '../lexical-bindings.ts';
import { walk } from './effect-lifecycle-syntax.ts';
import { resolveValue } from './module-factories.ts';

function fields(node: any): any[] {
  return node?.type === 'ObjectExpression' ? node.properties : [];
}

function callback(node: any): any {
  return node.arguments.find((argument: any) =>
    ['ArrowFunctionExpression', 'FunctionExpression'].includes(argument.type)
  );
}

function explicitReadiness(node: any): boolean {
  const ready = fields(node).find((part: any) => part.key?.name === 'ready')?.value;

  if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(ready?.type)) return false;

  function assertion(node: any): boolean {
    if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return false;

    let receiver = node.callee.object;

    while (receiver?.type === 'MemberExpression') receiver = receiver.object;

    return receiver?.type === 'CallExpression' && receiver.callee?.name === 'expect';
  }

  if (ready.body.type !== 'BlockStatement')
    return assertion(ready.body.type === 'AwaitExpression' ? ready.body.argument : ready.body);

  let waited = false;

  walk(ready.body, (node: any) => {
    let owner = node.parent;

    while (
      owner &&
      !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(owner.type)
    )
      owner = owner.parent;

    if (owner !== ready) return;

    if (
      (node.type === 'AwaitExpression' || node.type === 'ReturnStatement') &&
      assertion(node.argument)
    )
      waited = true;
  });

  return waited;
}

function awaitsScreenshot(node: any, local: string): boolean {
  if (node.type !== 'AwaitExpression') return false;

  const call = node.argument;

  if (call?.type !== 'CallExpression' || call.callee?.name !== local) return false;

  const name = call.arguments[0];

  return (
    name?.type === 'Literal' &&
    typeof name.value === 'string' &&
    explicitReadiness(call.arguments[1])
  );
}

function hasScreenshot(call: any): boolean {
  const body = callback(call);
  const parts = body?.params?.[0]?.properties ?? [];
  const part = parts.find((property: any) => property.key?.name === 'expectScreenshot');
  const local = part?.value?.name;

  if (!local) return false;

  let captured = false;

  walk(body.body, (node) => {
    if (awaitsScreenshot(node, local)) captured = true;
  });

  return captured;
}

const selectorActions = new Set([
  'click',
  'dblclick',
  'fill',
  'type',
  'check',
  'uncheck',
  'setChecked',
  'press',
  'hover',
  'focus',
  'tap',
  'selectOption',
  'setInputFiles',
  'dispatchEvent',
  'dragAndDrop',
  'waitForSelector'
]);

const domAccess = new Set([
  'dispatchEvent',
  'evaluate',
  'evaluateAll',
  'evaluateHandle',
  '$',
  '$$',
  '$eval',
  '$$eval',
  'elementHandle',
  'elementHandles'
]);

function callResult(method: string | null): string | null {
  if (
    /^(?:page|locator)\.(?:locator|frameLocator|getBy\w+|filter|first|last|nth|and|or|contentFrame|owner)$/.test(
      method ?? ''
    )
  )
    return 'locator';

  if (/^page\.(?:frame|mainFrame)$/.test(method ?? '')) return 'page';

  return method === 'page.frames' ? 'frames' : null;
}

function parameterPage(definition: any, name: string): boolean {
  if (definition?.type !== 'Parameter') return false;

  const part = definition.name?.parent;
  const key = part?.key?.name ?? part?.key?.value;

  return (part?.type === 'Property' && key === 'page') || ['page', 'frame'].includes(name);
}

function browserType(node: any): string | null {
  const name = node?.typeAnnotation?.typeAnnotation?.typeName?.name;
  const types: Record<string, string> = {
    Page: 'page',
    Frame: 'page',
    Locator: 'locator',
    FrameLocator: 'locator',
    ElementHandle: 'handle'
  };

  return types[name] ?? null;
}

// Undefined means absent; null means an unresolved property could override force.
function forceOption(context: any, node: any, seen = new Set<any>()): any {
  const value = resolveValue(context, node);

  if (!enterNode(value, seen) || value.type !== 'ObjectExpression') return null;

  for (const part of [...value.properties].reverse()) {
    if (part.type === 'SpreadElement') {
      const force = forceOption(context, part.argument, new Set(seen));

      if (force === undefined) continue;

      return force;
    }

    if (part.computed && part.key.type !== 'Literal') return null;

    if ((part.key.name ?? part.key.value) === 'force') return resolveValue(context, part.value);
  }

  return undefined;
}

function forceEnabled(context: any, options: any): boolean {
  const force = forceOption(context, options);

  return force !== undefined && !(force?.type === 'Literal' && force.value === false);
}

function browserBindings(context: any) {
  // shortcut: follow static constant aliases and known browser factories, not arbitrary data flow.
  function resolve(node: any, seen = new Set<any>()): string | null {
    if (!enterNode(node, seen)) return null;

    if (['AwaitExpression', 'TSAsExpression', 'TSNonNullExpression'].includes(node.type))
      return resolve(node.argument ?? node.expression, seen);

    if (node.type === 'CallExpression') return callResult(resolve(node.callee, seen));

    if (node.type === 'MemberExpression') {
      const base = resolve(node.object, seen);
      const name = memberName(node);

      if (base === 'frames') return 'page';

      return base && name ? `${base}.${name}` : null;
    }

    if (node.type !== 'Identifier') return null;

    return resolveIdentifier(node, seen);
  }

  function resolveIdentifier(node: any, seen: Set<any>): string | null {
    const definition = binding(context, node)?.defs[0];
    const declaration = definition?.node;
    const type = browserType(definition?.name);

    if (type) return type;

    if (!declaration && ['page', 'frame'].includes(node.name)) return 'page';

    if (parameterPage(definition, node.name)) return 'page';

    return resolveAlias(node, declaration, seen);
  }

  function resolveAlias(node: any, declaration: any, seen: Set<any>): string | null {
    return constantAliasValue(declaration, seen, resolve, (pattern, base) => {
      const part = destructuredBinding(pattern, node.name);
      const key = part?.key?.name ?? part?.key?.value;

      return base && key ? `${base}.${key}` : null;
    });
  }

  function forbidden(base: string | null, name: string | undefined): boolean {
    return Boolean(
      base &&
      name &&
      (base === 'handle' ||
        (['page', 'locator'].includes(base) && domAccess.has(name)) ||
        (base === 'page' &&
          (selectorActions.has(name) || ['mouse', 'request', 'context'].includes(name))))
    );
  }

  function forced(node: any): boolean {
    const action = resolve(node.callee)?.match(/^(page|locator)\.([^.]+)$/);
    const method = action?.[2];

    if (
      !method ||
      !(selectorActions.has(method) || ['dragTo', 'clear', 'selectText'].includes(method))
    )
      return false;

    const positions: Record<string, number> = {
      fill: 1,
      type: 1,
      press: 1,
      setChecked: 1,
      selectOption: 1,
      setInputFiles: 1,
      dragTo: 1,
      dragAndDrop: 1,
      dispatchEvent: 2
    };
    const index = (positions[method] ?? 0) + (action?.[1] === 'page' ? 1 : 0);
    const options = node.arguments[index];

    return options ? forceEnabled(context, options) : false;
  }

  return { resolve, forbidden, forced };
}

function destructuringKey(node: any): boolean {
  return (
    node.parent?.type === 'Property' &&
    node.parent.key === node &&
    !node.parent.computed &&
    node.parent.parent?.type === 'ObjectPattern'
  );
}

function descriptiveTitle(node: any): boolean {
  return (
    node?.type === 'Literal' &&
    typeof node.value === 'string' &&
    node.value.trim().split(/\s+/).length >= 2 &&
    !/\bW\d{3}\b/i.test(node.value)
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !/\/apps\/client\/test\/e2e\//.test(filename) ||
      filename.includes('/apps/client/test/e2e/harness/')
    )
      return {};

    const browser = browserBindings(context);
    const locatorMessage =
      'Use Playwright Locators for browser interactions; DOM handles, selector actions and mouse coordinates are forbidden.';
    const spec = /\.(?:test|spec)\.[jt]sx?$/.test(filename);
    const blocked = new Set([
      'route',
      'routeFromHAR',
      'routeWebSocket',
      'waitForTimeout',
      'sleep',
      'fetch'
    ]);
    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source || typeOnly) return;

      if (
        source === './harness/index.ts' &&
        (node.type !== 'ImportDeclaration' ||
          node.specifiers.some(
            (part: any) =>
              !['testE2e', 'expect'].includes(part.imported?.name) ||
              part.local?.name !== part.imported?.name
          ))
      )
        context.report({
          node,
          message:
            'Import testE2e directly; internal fixtures, aliases, reexports and dynamic imports are forbidden in journeys.'
        });

      if (/harness\//.test(source) && source !== './harness/index.ts')
        context.report({
          node,
          message: 'Journeys use only the public testE2e and Playwright assertion APIs.'
        });

      if (
        /^(?:playwright(?:-core)?(?:\/|$)|@playwright\/|@study\/db(?:\/|$)|@study\/server(?:\/|$)|vite(?:-plus)?$|node:(?:http|net|child_process|timers(?:\/promises)?))/.test(
          source
        )
      )
        context.report({
          node,
          message: 'Browser specs must acquire resources through the shared E2E harness.'
        });
    });

    function canonical(node: any): boolean {
      const declaration = binding(context, node)?.defs[0]?.node;

      if (declaration?.type !== 'ImportSpecifier') return false;

      return (
        declaration.imported?.name === 'testE2e' &&
        declaration.parent?.source?.value === './harness/index.ts'
      );
    }

    function root(node: any): any {
      if (node?.type === 'CallExpression') return root(node.callee);

      if (node?.type === 'MemberExpression') return root(node.object);

      return node;
    }

    function registration(node: any): boolean {
      const owner = root(node.callee);

      return (
        owner?.type === 'Identifier' &&
        /^test(?:Stable|E2e|Regression|Migration|Characterization)$/.test(owner.name) &&
        !(node.parent?.type === 'CallExpression' && node.parent.callee === node)
      );
    }

    return {
      ...edges,
      Program(node: any) {
        const name = filename.split('/').at(-1) ?? '';

        if (spec && /^(?:w\d+|workflow[-_]\d+)(?:[-_.]|$)/i.test(name))
          context.report({
            node,
            message:
              'Name journey files after behavior, like plain-note.test.ts; workflow IDs belong in the local tracker.'
          });
      },
      MemberExpression(node: any) {
        if (browser.forbidden(browser.resolve(node.object), memberName(node)))
          context.report({ node, message: locatorMessage });

        if (
          blocked.has(memberName(node) ?? '') ||
          (memberName(node) === 'setTimeout' &&
            ['globalThis', 'window', 'global'].includes(node.object?.name) &&
            !binding(context, node.object)?.defs.length)
        )
          context.report({
            node,
            message: 'Browser specs cannot mock requests or use fixed waits.'
          });
      },
      Identifier(node: any) {
        if (
          ['setTimeout', 'fetch', 'XMLHttpRequest', 'WebSocket'].includes(node.name) &&
          node.parent?.type !== 'ImportSpecifier' &&
          !binding(context, node)?.defs.length &&
          !destructuringKey(node) &&
          !(
            node.parent?.type === 'MemberExpression' &&
            node.parent.property === node &&
            !node.parent.computed
          )
        )
          context.report({ node, message: 'Browser specs cannot use fixed waits.' });
      },
      ObjectPattern(node: any) {
        const parameter = node.parent?.type === 'AssignmentPattern' ? node.parent : node;

        if (!parameter.parent?.params?.includes(parameter)) return;

        for (const part of node.properties)
          if (browser.forbidden(browserType(node), part.key?.name ?? part.key?.value))
            context.report({ node: part, message: locatorMessage });
      },
      VariableDeclarator(node: any) {
        if (node.id.type === 'ObjectPattern')
          for (const part of node.id.properties)
            if (browser.forbidden(browser.resolve(node.init), part.key?.name ?? part.key?.value))
              context.report({ node: part, message: locatorMessage });

        if (
          node.id.type === 'ObjectPattern' &&
          node.id.properties.some((part: any) => blocked.has(part.key?.name ?? part.key?.value))
        )
          context.report({
            node,
            message: 'Browser specs cannot mock requests or use fixed waits.'
          });
      },
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (browser.forced(node))
          context.report({
            node,
            message: 'Use locator actionability checks instead of force: true.'
          });

        if (!spec || !registration(node)) return;

        if (!canonical(node.callee)) {
          context.report({
            node,
            message: 'Declare every browser journey directly with testE2e from the shared harness.'
          });

          return;
        }

        if (!hasScreenshot(node))
          context.report({
            node,
            message: 'Every E2E must await a named screenshot with explicit readiness.'
          });

        if (!descriptiveTitle(node.arguments[0]))
          context.report({
            node,
            message: 'Give each E2E a clear behavior title without a workflow ID.'
          });
      }
    };
  }
});
