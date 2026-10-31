import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport, featureRole, targetPath } from '../architecture-imports.ts';
import {
  binding,
  memberName as property,
  constantDeclarator,
  enterNode
} from '../lexical-bindings.ts';
import { property as field, walk } from './effect-lifecycle-syntax.ts';
import { production } from './synchronous-transactions.ts';

type FactoryOwner = 'service' | 'store' | 'rpc' | 'workflow' | 'workflow-handler';

export function entry(
  filename: string
): { domain: string; owner: FactoryOwner; index: boolean } | null {
  const path = filename.replaceAll('\\', '/');

  if (!production(path)) return null;

  const role = featureRole(path);

  if (/\/apps\/server\/src\/features\//.test(path) && (role === 'rpc' || role === 'workflow'))
    return { domain: /features\/([^/]+)/.exec(path)![1], owner: role, index: false };

  const match =
    /\/apps\/server\/src\/features\/([^/]+)\/(index\.ts|(?:service|store)\/index\.ts)$/.exec(path);

  if (!match) {
    const legacy =
      /\/apps\/server\/src\/features\/([^/]+)\/((?:[^/]+\/)*(?:[^/]+\.)?(service|store)\.ts)$/.exec(
        path
      );

    return legacy
      ? { domain: legacy[1], owner: legacy[3] as 'service' | 'store', index: false }
      : null;
  }

  return {
    domain: match[1],
    owner: match[2] === 'store/index.ts' ? 'store' : 'service',
    index: match[2] === 'index.ts'
  };
}

export function resolveValue(context: any, node: any, seen = new Set<any>()): any {
  if (!enterNode(node, seen)) return null;

  if (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'ParenthesizedExpression'
    ].includes(node.type)
  )
    return resolveValue(context, node.expression, seen);

  if (node.type === 'Identifier') {
    const def = binding(context, node)?.defs[0]?.node;

    if (def?.type === 'FunctionDeclaration') return def;

    if (constantDeclarator(def)) return resolveValue(context, def.init, seen);
  }

  return node;
}

export function isFactory(context: any, node: any, owner: FactoryOwner): boolean {
  const expected =
    owner === 'workflow-handler'
      ? 'defineWorkflowHandler'
      : `define${owner[0].toUpperCase()}${owner.slice(1)}`;

  return canonicalImport(context, node, `define-${owner}`, expected);
}

export function factoryCall(context: any, node: any, owner: FactoryOwner): any {
  const value = resolveValue(context, node);

  return value?.type === 'CallExpression' && isFactory(context, value.callee, owner) ? value : null;
}

export function entryReexport(context: any, node: any, domain: string): boolean {
  const target = targetPath(context.filename, node.source?.value);

  return (
    target === `features/${domain}/service/index` ||
    target === `features/${domain}/${domain}.service` ||
    target === `features/${domain}/service`
  );
}

/** Keep public domain entry exports on the canonical construction boundary. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const info = entry(context.filename);

    if (!info) return {};

    const { owner, domain, index } = info;
    const expected =
      owner === 'workflow'
        ? 'defineWorkflowHandler'
        : `define${owner[0].toUpperCase()}${owner.slice(1)}`;
    let runtimeExport = false;
    const executions = new Set<any>();

    function check(node: any, value: any) {
      runtimeExport = true;

      if (factoryCall(context, value, owner)) return;

      if (owner === 'workflow' && factoryCall(context, value, 'workflow-handler')) return;

      const resolved = resolveValue(context, value);

      if (workflowExecution(resolved)) return;

      if (
        owner === 'service' &&
        property(resolved) === 'layer' &&
        factoryCall(context, resolved.object, 'service')
      )
        return;

      context.report({ node, message: `Exported feature ${owner} modules must use ${expected}.` });
    }

    function workflowExecution(resolved: any): boolean {
      return (
        owner === 'workflow' &&
        executions.has(resolved) &&
        ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(
          resolved?.type
        )
      );
    }

    function checkReexport(node: any) {
      if (
        node.specifiers.length > 0 &&
        node.specifiers.every((specifier: any) => specifier.exportKind === 'type')
      )
        return;

      if (node.specifiers.some((specifier: any) => specifier.exportKind !== 'type'))
        runtimeExport = true;

      if (!index || !entryReexport(context, node, domain))
        context.report({
          node,
          message: `Feature ${owner} exports must be defined by ${expected}.`
        });
    }

    return {
      Program(node: any) {
        if (owner !== 'workflow') return;

        walk(node, (part: any) => {
          if (
            part.type !== 'CallExpression' ||
            !isFactory(context, part.callee, 'workflow-handler')
          )
            return;

          const options = resolveValue(context, part.arguments[1]);

          executions.add(resolveValue(context, field(options, 'execute')));
        });
      },
      ExportNamedDeclaration(node: any) {
        if (node.exportKind === 'type') return;

        if (node.source) {
          checkReexport(node);

          return;
        }

        if (node.declaration?.type === 'VariableDeclaration')
          for (const item of node.declaration.declarations) check(item, item.init);
        else if (['ClassDeclaration', 'FunctionDeclaration'].includes(node.declaration?.type))
          check(node.declaration, node.declaration);

        for (const specifier of node.specifiers)
          if (specifier.exportKind !== 'type') check(specifier, specifier.local);
      },
      ExportAllDeclaration(node: any) {
        if (node.exportKind !== 'type') runtimeExport = true;

        if (node.exportKind !== 'type' && (!index || !entryReexport(context, node, domain)))
          context.report({
            node,
            message: `Feature ${owner} exports must be defined by ${expected}.`
          });
      },
      ExportDefaultDeclaration(node: any) {
        check(node, node.declaration);
      },
      'Program:exit'(node: any) {
        if (owner === 'store' && !runtimeExport)
          context.report({ node, message: 'Export a feature store using defineStore.' });
      }
    };
  }
});
