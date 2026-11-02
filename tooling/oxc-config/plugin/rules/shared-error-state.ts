import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';
import { children as nodes, stateComparison } from './jsx-state.ts';

const errorFlag = /^(?:is)?(?:error|failed|failure)$|Error$/i;

const failedStates = new Set(['error', 'failed', 'failure']);

const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function errorMember(node: ESTree.MemberExpression): boolean {
  return (
    (!node.computed || node.property.type === 'Literal') &&
    errorFlag.test(propertyName(node.property) ?? '')
  );
}

function errorLogical(node: ESTree.LogicalExpression, truth: boolean): boolean {
  const left = errorWhen(node.left, truth);
  const right = errorWhen(node.right, truth);

  return (node.operator === '&&') === truth ? left || right : left && right;
}

function errorWhen(node: ESTree.Node, truth: boolean): boolean {
  switch (node.type) {
    case 'Identifier':
      return truth && errorFlag.test(node.name);
    case 'MemberExpression':
      return truth && errorMember(node);
    case 'UnaryExpression':
      return node.operator === '!' && errorWhen(node.argument, !truth);
    case 'LogicalExpression':
      return errorLogical(node, truth);
    case 'BinaryExpression':
      return stateComparison(node, truth, failedStates);
    default:
      return false;
  }
}

function attributes(node: ESTree.JSXElement, name: string): ESTree.Node | null | undefined {
  const attribute = node.openingElement.attributes.find(
    (item): item is ESTree.JSXAttribute => item.type === 'JSXAttribute' && item.name.name === name
  );

  return attribute?.value?.type === 'JSXExpressionContainer'
    ? attribute.value.expression
    : attribute?.value;
}

/** A field error belongs to its control rather than replacing a page or operation. */
function fieldValidation(node: ESTree.JSXElement): boolean {
  const id = attributes(node, 'id');

  if (id?.type !== 'Literal' || typeof id.value !== 'string') return false;

  const value = id.value;
  let parent: ESTree.Node | null = node.parent;

  while (parent && !functions.has(parent.type)) {
    if (parent.type === 'JSXElement') {
      const linked = (item: ESTree.Node): boolean => {
        if (item.type === 'JSXElement') {
          const reference =
            attributes(item, 'aria-describedby') ?? attributes(item, 'aria-errormessage');

          if (
            reference?.type === 'Literal' &&
            typeof reference.value === 'string' &&
            reference.value.split(/\s+/).includes(value) &&
            attributes(item, 'aria-invalid') !== undefined
          )
            return true;
        }

        return nodes(item).some(linked);
      };

      if (linked(parent)) return true;
    }

    parent = parent.parent;
  }

  return false;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!webFile(context.filename)) return {};

    const bindings = effectBindings(context);
    const imports = new Map<ESTree.Node, string>();
    const buttons = new Set<ESTree.Node>();
    const sidebars = new Set<ESTree.Node>();
    const sidebarNamespaces = new Set<ESTree.Node>();
    const message =
      'Render ErrorState from @study/ui/error-state for error feedback; keep recovery actions inside the shared presentation.';

    function canonical(node: ESTree.JSXElement): boolean {
      const name = node.openingElement.name;

      if (sidebarMessage(name)) return true;

      if (name.type === 'JSXIdentifier')
        return imports.get(bindings.definition(name)) === 'ErrorState';

      return (
        name.type === 'JSXMemberExpression' &&
        name.object.type === 'JSXIdentifier' &&
        imports.get(bindings.definition(name.object)) === '*' &&
        name.property.name === 'ErrorState'
      );
    }

    function sidebarMessage(name: ESTree.JSXElement['openingElement']['name']): boolean {
      if (name.type !== 'JSXMemberExpression' || name.property.name !== 'Message') return false;

      const owner = name.object;

      if (owner.type === 'JSXIdentifier') return sidebars.has(bindings.definition(owner));

      return (
        owner.property.name === 'Sidebar' &&
        owner.object.type === 'JSXIdentifier' &&
        sidebarNamespaces.has(bindings.definition(owner.object))
      );
    }

    function customChild(child: ESTree.Node, host: boolean, seen: Set<ESTree.Node>): boolean {
      if (host && child.type === 'JSXText' && child.value.trim().length > 0) return true;

      if (
        host &&
        child.type === 'JSXExpressionContainer' &&
        child.expression.type === 'CallExpression'
      )
        return true;

      return custom(child, new Set(seen));
    }

    function customElement(node: ESTree.JSXElement, seen: Set<ESTree.Node>): boolean {
      if (canonical(node) || fieldValidation(node)) return false;

      const role = attributes(node, 'role');

      if (role?.type === 'Literal' && role.value === 'alert') return false;

      const name = node.openingElement.name;

      if (name.type !== 'JSXIdentifier')
        return node.children.some((child) => custom(child, new Set(seen)));

      if (['input', 'textarea', 'select', 'option'].includes(name.name)) return false;

      const host = /^[a-z]/.test(name.name) || buttons.has(bindings.definition(name));

      return node.children.some((child) => customChild(child, host, seen));
    }

    function customAlias(
      node: Extract<ESTree.Node, { type: 'Identifier' }>,
      seen: Set<ESTree.Node>
    ): boolean {
      const definition = bindings.definition(node);

      return (
        definition?.type === 'VariableDeclarator' &&
        definition.parent?.kind === 'const' &&
        custom(definition.init, seen)
      );
    }

    function custom(node: ESTree.Node | null | undefined, seen = new Set<ESTree.Node>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'JSXElement') return customElement(node, seen);

      if (node.type === 'Identifier') return customAlias(node, seen);

      if (node.type === 'JSXFragment')
        return node.children.some((child) => custom(child, new Set(seen)));

      if (
        [
          'JSXExpressionContainer',
          'TSAsExpression',
          'TSSatisfiesExpression',
          'TSNonNullExpression'
        ].includes(node.type)
      )
        return custom((node as ESTree.JSXExpressionContainer).expression, seen);

      return false;
    }

    function check(node: ESTree.Node | null | undefined): void {
      if (node && custom(node)) context.report({ node, message });
    }

    function checkReturns(node: ESTree.Node | null): void {
      if (!node || functions.has(node.type)) return;

      if (node.type === 'ReturnStatement') check(node.argument);
      else for (const child of nodes(node)) checkReturns(child);
    }

    function recordImports(
      node: ESTree.ImportDeclaration,
      name: string,
      named: Set<ESTree.Node>,
      namespaces?: Set<ESTree.Node>
    ): void {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') namespaces?.add(specifier);
        else if (
          specifier.type === 'ImportSpecifier' &&
          specifier.importKind !== 'type' &&
          propertyName(specifier.imported) === name
        )
          named.add(specifier);
      }
    }

    const errorStates = new Set<ESTree.Node>();
    const errorNamespaces = new Set<ESTree.Node>();

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return;

        switch (node.source.value) {
          case '@study/ui/sidebar':
            recordImports(node, 'Sidebar', sidebars, sidebarNamespaces);
            break;
          case '@study/ui/button':
            recordImports(node, 'Button', buttons);
            break;
          case '@study/ui/error-state':
            recordImports(node, 'ErrorState', errorStates, errorNamespaces);

            for (const specifier of errorStates) imports.set(specifier, 'ErrorState');

            for (const specifier of errorNamespaces) imports.set(specifier, '*');
        }
      },
      JSXElement(node) {
        const role = attributes(node, 'role');

        if (
          role?.type === 'Literal' &&
          role.value === 'alert' &&
          !canonical(node) &&
          !fieldValidation(node)
        )
          context.report({ node: node.openingElement, message });
      },
      FunctionDeclaration(node) {
        if (
          /^[A-Z]/.test(node.id?.name ?? '') &&
          /(?:Error|Failure)(?:State|Page|Fallback)?$/.test(node.id?.name ?? '')
        )
          checkReturns(node.body);
      },
      ArrowFunctionExpression(node) {
        const owner = node.parent;

        if (
          owner?.type !== 'VariableDeclarator' ||
          owner.id.type !== 'Identifier' ||
          !/^[A-Z]/.test(owner.id.name) ||
          !/(?:Error|Failure)(?:State|Page|Fallback)?$/.test(owner.id.name)
        )
          return;

        if (node.body.type === 'BlockStatement') checkReturns(node.body);
        else check(node.body);
      },
      IfStatement(node) {
        if (errorWhen(node.test, true)) checkReturns(node.consequent);

        if (node.alternate && errorWhen(node.test, false)) checkReturns(node.alternate);
      },
      ConditionalExpression(node) {
        if (errorWhen(node.test, true)) check(node.consequent);

        if (errorWhen(node.test, false)) check(node.alternate);
      },
      LogicalExpression(node) {
        if (errorWhen(node.left, node.operator === '&&')) check(node.right);
      }
    };
  }
});
