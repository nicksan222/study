import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';
import { children } from './jsx-state.ts';

const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const loadingName = /^(?:Loading|LoadingSkeleton|Spinner|Loader(?:Circle|Pinwheel)?(?:Icon)?)$/;
const message =
  'Keep initial page loading in the shared route transition. Component loading indicators are allowed.';

function owner(node: ESTree.Node): ESTree.Node | undefined {
  let parent: ESTree.Node | null = node.parent;
  while (parent && !functions.has(parent.type)) parent = parent.parent;
  return parent ?? undefined;
}

function name(node: ESTree.Node): string {
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')
    return node.id?.name ?? '';
  if (node.parent?.type === 'VariableDeclarator' && node.parent.id.type === 'Identifier')
    return node.parent.id.name;
  return '';
}

function visual(node: ESTree.Node | null | undefined, aliases: ReadonlySet<string>): boolean {
  if (!node) return false;
  if (node.type === 'JSXOpeningElement') {
    const tag =
      node.name.type === 'JSXIdentifier'
        ? node.name.name
        : node.name.type === 'JSXMemberExpression'
          ? node.name.property.name
          : '';
    if (loadingName.test(tag) || aliases.has(tag)) return true;
  }
  if (node.type === 'CallExpression') {
    const key = node.arguments[0];
    if (
      key?.type === 'Literal' &&
      typeof key.value === 'string' &&
      /^(?:Loading[A-Z]|Searching$)/.test(key.value)
    )
      return true;
  }
  if (
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    /animate-(?:spin|pulse)|loading-skeleton|loading-placeholder/.test(node.value)
  )
    return true;
  return children(node).some((child) => visual(child, aliases));
}

function loading(node: ESTree.Node): boolean {
  if (node.type === 'Identifier') return /^(?:is)?(?:loading|pending|fetching)$/i.test(node.name);
  if (node.type === 'MemberExpression')
    return /^(?:is)?(?:loading|pending|fetching)$/i.test(propertyName(node.property) ?? '');
  if (node.type === 'LogicalExpression') return loading(node.left) || loading(node.right);
  if (node.type === 'BinaryExpression')
    return [node.left, node.right].some(
      (value) => value.type === 'Literal' && ['pending', 'loading'].includes(String(value.value))
    );
  return false;
}

function initialReturn(node: ESTree.ReturnStatement, fn: ESTree.Node): boolean {
  let parent: ESTree.Node | null = node.parent;
  while (parent && parent !== fn) {
    if (parent.type === 'IfStatement' && loading(parent.test)) return true;
    parent = parent.parent;
  }
  return false;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = webFile(context.filename);
    if (!path) return {};
    const aliases = new Set<string>();

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            loadingName.test(propertyName(specifier.imported) ?? '')
          )
            aliases.add(specifier.local.name);
        }
      },
      Property(node) {
        const key = propertyName(node.key);
        if (
          !['pendingComponent', 'defaultPendingComponent'].includes(key ?? '') ||
          !(path.startsWith('routes/') || path === 'app/router.ts')
        )
          return;
        const value = node.value;
        if (
          (value.type === 'Identifier' && value.name === 'RoutePending') ||
          (value.type === 'Literal' && value.value === null)
        )
          return;
        context.report({
          node,
          message:
            'Use the shared RoutePending boundary instead of a custom initial page loading component.'
        });
      },
      ArrowFunctionExpression(node) {
        if (!/(?:Page(?:View)?|Screen)$/.test(name(node))) return;
        if (
          node.body.type === 'ConditionalExpression' &&
          loading(node.body.test) &&
          visual(node.body.consequent, aliases)
        )
          context.report({ node: node.body, message });
      },
      LogicalExpression(node) {
        const fn = owner(node);
        if (!fn || !/(?:Page(?:View)?|Screen)$/.test(name(fn))) return;
        if (node.operator === '&&' && loading(node.left) && visual(node.right, aliases))
          context.report({ node, message });
      },
      ReturnStatement(node) {
        const fn = owner(node);
        if (!fn) return;
        const component = name(fn);
        if (component === 'RoutePending') {
          if (node.argument && !(node.argument.type === 'Literal' && node.argument.value === null))
            context.report({ node, message });
          return;
        }
        const page =
          /(?:Page(?:View)?|Screen)$/.test(component) ||
          (path.startsWith('routes/') && /^(?:RouteComponent|Component)$/.test(component));
        if (!page) return;
        if (initialReturn(node, fn) && visual(node.argument, aliases))
          context.report({ node, message });
        if (
          node.argument?.type === 'ConditionalExpression' &&
          loading(node.argument.test) &&
          visual(node.argument.consequent, aliases)
        )
          context.report({ node, message });
      }
    };
  }
});
