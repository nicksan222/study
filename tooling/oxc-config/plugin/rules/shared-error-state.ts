import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';

const errorFlag = /^(?:is)?(?:error|failed|failure)$|Error$/i;
const failedStates = new Set(['error', 'failed', 'failure']);
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function errorWhen(node: ESTree.Node, truth: boolean): boolean {
  if (node.type === 'Identifier') return truth && errorFlag.test(node.name);
  if (node.type === 'MemberExpression')
    return (
      truth &&
      (!node.computed || node.property.type === 'Literal') &&
      errorFlag.test(propertyName(node.property) ?? '')
    );
  if (node.type === 'UnaryExpression')
    return node.operator === '!' && errorWhen(node.argument, !truth);
  if (node.type === 'LogicalExpression') {
    const left = errorWhen(node.left, truth);
    const right = errorWhen(node.right, truth);
    return (node.operator === '&&') === truth ? left || right : left && right;
  }
  if (node.type !== 'BinaryExpression' || !['===', '==', '!==', '!='].includes(node.operator))
    return false;
  const value = node.left.type === 'Literal' ? node.left : node.right;
  return (
    value.type === 'Literal' &&
    typeof value.value === 'string' &&
    failedStates.has(value.value) &&
    truth === (node.operator === '===' || node.operator === '==')
  );
}

function attributes(node: ESTree.JSXElement, name: string): ESTree.Node | null | undefined {
  const attribute = node.openingElement.attributes.find(
    (item): item is ESTree.JSXAttribute => item.type === 'JSXAttribute' && item.name.name === name
  );
  return attribute?.value?.type === 'JSXExpressionContainer'
    ? attribute.value.expression
    : attribute?.value;
}

function nodes(node: ESTree.Node): ESTree.Node[] {
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'parent'
      ? []
      : (Array.isArray(value) ? value : [value]).filter(
          (item): item is ESTree.Node =>
            item !== null && typeof item === 'object' && typeof item.type === 'string'
        )
  );
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
      if (name.type === 'JSXMemberExpression' && name.property.name === 'Message') {
        if (name.object.type === 'JSXIdentifier' && sidebars.has(bindings.definition(name.object)))
          return true;
        if (
          name.object.type === 'JSXMemberExpression' &&
          name.object.property.name === 'Sidebar' &&
          name.object.object.type === 'JSXIdentifier' &&
          sidebarNamespaces.has(bindings.definition(name.object.object))
        )
          return true;
      }
      if (name.type === 'JSXIdentifier')
        return imports.get(bindings.definition(name)) === 'ErrorState';
      return (
        name.type === 'JSXMemberExpression' &&
        name.object.type === 'JSXIdentifier' &&
        imports.get(bindings.definition(name.object)) === '*' &&
        name.property.name === 'ErrorState'
      );
    }
    function custom(node: ESTree.Node | null | undefined, seen = new Set<ESTree.Node>()): boolean {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (node.type === 'JSXElement') {
        if (canonical(node) || fieldValidation(node)) return false;
        const role = attributes(node, 'role');
        if (role?.type === 'Literal' && role.value === 'alert') return false; // The alert visitor reports this once.
        const name = node.openingElement.name;
        const host =
          name.type === 'JSXIdentifier' &&
          (/^[a-z]/.test(name.name) || buttons.has(bindings.definition(name)));
        if (
          name.type === 'JSXIdentifier' &&
          ['input', 'textarea', 'select', 'option'].includes(name.name)
        )
          return false;
        return node.children.some(
          (child) =>
            (host && child.type === 'JSXText' && child.value.trim().length > 0) ||
            (host &&
              child.type === 'JSXExpressionContainer' &&
              child.expression.type === 'CallExpression') ||
            custom(child, new Set(seen))
        );
      }
      if (node.type === 'Identifier') {
        const definition = bindings.definition(node);
        return (
          definition?.type === 'VariableDeclarator' &&
          definition.parent?.kind === 'const' &&
          custom(definition.init, seen)
        );
      }
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
    function checkReturns(node: ESTree.Node): void {
      if (functions.has(node.type)) return;
      if (node.type === 'ReturnStatement') check(node.argument);
      else for (const child of nodes(node)) checkReturns(child);
    }
    return {
      ImportDeclaration(node) {
        if (node.importKind !== 'type' && node.source.value === '@study/ui/sidebar') {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier') sidebarNamespaces.add(specifier);
            else if (
              specifier.type === 'ImportSpecifier' &&
              specifier.importKind !== 'type' &&
              propertyName(specifier.imported) === 'Sidebar'
            )
              sidebars.add(specifier);
          }
        }
        if (node.importKind !== 'type' && node.source.value === '@study/ui/button') {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.importKind !== 'type' &&
              propertyName(specifier.imported) === 'Button'
            )
              buttons.add(specifier);
          }
        }
        if (node.importKind === 'type' || node.source.value !== '@study/ui/error-state') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') imports.set(specifier, '*');
          else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            propertyName(specifier.imported) === 'ErrorState'
          )
            imports.set(specifier, 'ErrorState');
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
