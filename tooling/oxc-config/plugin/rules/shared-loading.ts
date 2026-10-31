import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';

const loadingFlag =
  /^(?:is)?(?:loading|pending|fetching|searching|submitting|saving|creating|uploading|processing)$/i;

const loadingStatus = new Set(['idle', 'loading', 'pending', 'fetching']);

const loadingAnimation = /(?:^|[\s:])(?:visible-)?animate-(?:spin|pulse)(?=\s|$)/;

const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function children(node: ESTree.Node): ESTree.Node[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'parent') return [];

    const values = Array.isArray(value) ? value : [value];

    return values.filter(
      (item): item is ESTree.Node =>
        item !== null && typeof item === 'object' && typeof item.type === 'string'
    );
  });
}

function loadingMember(node: ESTree.MemberExpression): boolean {
  return (
    (!node.computed || node.property.type === 'Literal') &&
    loadingFlag.test(propertyName(node.property) ?? '')
  );
}

function loadingComparison(
  node: Extract<ESTree.Node, { type: 'BinaryExpression' }>,
  truth: boolean
): boolean {
  if (!['===', '==', '!==', '!='].includes(node.operator)) return false;

  const value = node.left.type === 'Literal' ? node.left : node.right;

  return (
    value.type === 'Literal' &&
    typeof value.value === 'string' &&
    loadingStatus.has(value.value) &&
    truth === (node.operator === '===' || node.operator === '==')
  );
}

function loadingLogical(node: ESTree.LogicalExpression, truth: boolean): boolean {
  const left = loadingWhen(node.left, truth);
  const right = loadingWhen(node.right, truth);

  return (node.operator === '&&') === truth ? left || right : left && right;
}

function loadingWhen(node: ESTree.Node, truth: boolean): boolean {
  switch (node.type) {
    case 'UnaryExpression':
      return node.operator === '!' && loadingWhen(node.argument, !truth);
    case 'Identifier':
      return truth && loadingFlag.test(node.name);
    case 'MemberExpression':
      return truth && loadingMember(node);
    case 'BinaryExpression':
      return loadingComparison(node, truth);
    case 'LogicalExpression':
      return loadingLogical(node, truth);
    default:
      return false;
  }
}

function nearestFunction(node: ESTree.Node): ESTree.Node | null {
  let current: ESTree.Node | null = node;

  while (current && !functions.has(current.type)) current = current.parent;

  return current;
}

function functionName(node: ESTree.Node): string | undefined {
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')
    return node.id?.name;

  const parent = node.parent;

  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
    return parent.id.name;

  return undefined;
}

function componentReturn(node: ESTree.Node): boolean {
  const owner = nearestFunction(node);

  return owner ? /^[A-Z]/.test(functionName(owner) ?? '') : false;
}

function renderContext(parent: ESTree.Node): boolean | undefined {
  if (['JSXAttribute', 'CallExpression'].includes(parent.type) || functions.has(parent.type))
    return false;

  if (
    parent.type === 'JSXExpressionContainer' &&
    ['JSXElement', 'JSXFragment'].includes(parent.parent?.type ?? '')
  )
    return true;

  if (parent.type === 'ReturnStatement') return componentReturn(parent);

  return undefined;
}

function rendered(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node;

  while (current?.parent) {
    const result = renderContext(current.parent);

    if (result !== undefined) return result;

    current = current.parent;
  }

  return false;
}

type ExpressionWrapper =
  | ESTree.JSXExpressionContainer
  | ESTree.TSAsExpression
  | ESTree.TSSatisfiesExpression
  | ESTree.TSNonNullExpression;

function expressionWrapper(node: ESTree.Node): node is ExpressionWrapper {
  return [
    'JSXExpressionContainer',
    'TSAsExpression',
    'TSSatisfiesExpression',
    'TSNonNullExpression'
  ].includes(node.type);
}

function attributeValue(attribute: ESTree.JSXAttribute) {
  return attribute.value?.type === 'JSXExpressionContainer'
    ? attribute.value.expression
    : attribute.value;
}

function loadingMessage(child: ESTree.Node): boolean {
  if (child.type !== 'JSXExpressionContainer' || child.expression.type !== 'CallExpression')
    return false;

  const key = child.expression.arguments[0];

  return (
    key?.type === 'Literal' &&
    typeof key.value === 'string' &&
    /^(?:Loading[A-Z]|Searching$)/.test(key.value)
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const web = Boolean(webFile(filename));
    const ui = /\/packages\/ui\/src\//.test(filename);

    if (
      (!web && !ui) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests|__tests__)\//.test(filename) ||
      /\/packages\/ui\/src\/components\/(?:spinner|loading)\.tsx$/.test(filename)
    )
      return {};

    const bindings = effectBindings(context);
    const imports = new Map<ESTree.Node, { source: string; name: string }>();
    const message =
      'Render Loading or LoadingSkeleton from @study/ui/loading, or Spinner from @study/ui/spinner, for loading states.';

    function imported(node: ESTree.Node): { source: string; name: string } | undefined {
      if (node.type === 'JSXIdentifier' || node.type === 'Identifier')
        return imports.get(bindings.definition(node));

      if (node.type !== 'JSXMemberExpression') return undefined;

      const namespace = imported(node.object);

      return namespace &&
        (namespace.name === '*' || (namespace.source === 'react' && namespace.name === 'default'))
        ? { source: namespace.source, name: node.property.name }
        : undefined;
    }

    function shared(node: ESTree.JSXElement): boolean {
      const binding = imported(node.openingElement.name);

      return Boolean(
        binding &&
        ((binding.source === '@study/ui/loading' &&
          ['Loading', 'LoadingSkeleton'].includes(binding.name)) ||
          (binding.source === '@study/ui/spinner' && binding.name === 'Spinner'))
      );
    }

    function jsxIndicator(
      node: ESTree.JSXElement | ESTree.JSXFragment,
      seen: Set<ESTree.Node>,
      busyWhen?: ESTree.Node
    ): boolean {
      if (node.type === 'JSXElement' && shared(node)) return true;

      return node.children.some((child) => indicator(child, new Set(seen), busyWhen));
    }

    function conditionalIndicator(
      node: ESTree.ConditionalExpression,
      seen: Set<ESTree.Node>,
      busyWhen?: ESTree.Node
    ): boolean {
      if (
        busyWhen &&
        context.sourceCode.getText(node.test) === context.sourceCode.getText(busyWhen)
      )
        return indicator(node.consequent, seen, busyWhen);

      return (
        indicator(node.consequent, new Set(seen), busyWhen) &&
        indicator(node.alternate, new Set(seen), busyWhen)
      );
    }

    function aliasIndicator(
      node: Extract<ESTree.Node, { type: 'Identifier' }>,
      seen: Set<ESTree.Node>,
      busyWhen?: ESTree.Node
    ): boolean {
      const definition = bindings.definition(node);

      return definition?.type === 'VariableDeclarator' && definition.parent?.kind === 'const'
        ? indicator(definition.init, seen, busyWhen)
        : false;
    }

    function indicator(
      node: ESTree.Node | null | undefined,
      seen = new Set<ESTree.Node>(),
      busyWhen?: ESTree.Node
    ): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'JSXElement' || node.type === 'JSXFragment')
        return jsxIndicator(node, seen, busyWhen);

      if (expressionWrapper(node)) return indicator(node.expression, seen, busyWhen);

      if (node.type === 'LogicalExpression' && node.operator === '&&')
        return indicator(node.right, seen, busyWhen);

      if (node.type === 'ConditionalExpression') return conditionalIndicator(node, seen, busyWhen);

      if (node.type === 'Identifier') return aliasIndicator(node, seen, busyWhen);

      return false;
    }

    function requireIndicator(node: ESTree.Node | null | undefined, reportNode = node): void {
      if (node && reportNode && !indicator(node)) context.report({ node: reportNode, message });
    }

    function checkReturns(node: ESTree.Node): void {
      if (functions.has(node.type)) return;

      if (node.type === 'ReturnStatement') {
        if (!indicator(node.argument)) context.report({ node, message });

        return;
      }

      for (const child of children(node)) checkReturns(child);
    }

    function checkLoaderIcon(node: ESTree.JSXElement): void {
      const binding = imported(node.openingElement.name);

      if (
        node.openingElement.name.type === 'JSXMemberExpression' &&
        binding?.source === 'lucide-react' &&
        /^Loader(?:Circle|Pinwheel)?(?:Icon)?$/.test(binding.name)
      )
        context.report({
          node: node.openingElement,
          message: 'Use Spinner from @study/ui/spinner instead of a raw loader icon.'
        });
    }

    function checkSuspense(node: ESTree.JSXElement): void {
      const fallback = node.openingElement.attributes.find(
        (attribute): attribute is ESTree.JSXAttribute =>
          attribute.type === 'JSXAttribute' && attribute.name.name === 'fallback'
      );

      if (!fallback) {
        context.report({ node: node.openingElement, message });

        return;
      }

      requireIndicator(attributeValue(fallback), fallback);
    }

    function checkBusyAttribute(node: ESTree.JSXElement, attribute: ESTree.JSXAttribute): void {
      const value = attributeValue(attribute);
      const inactive =
        value?.type === 'Literal' && (value.value === false || value.value === 'false');

      if (!inactive && !indicator(node, undefined, value ?? undefined))
        context.report({ node: attribute, message });
    }

    function checkBusyRegion(node: ESTree.JSXElement): void {
      for (const attribute of node.openingElement.attributes) {
        if (attribute.type === 'JSXAttribute' && attribute.name.name === 'aria-busy')
          checkBusyAttribute(node, attribute);
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type') continue;

          const name =
            specifier.type === 'ImportNamespaceSpecifier'
              ? '*'
              : specifier.type === 'ImportSpecifier'
                ? propertyName(specifier.imported)
                : 'default';

          if (!name) continue;

          imports.set(specifier, { source: node.source.value, name });

          if (
            node.source.value === 'lucide-react' &&
            /^Loader(?:Circle|Pinwheel)?(?:Icon)?$/.test(name)
          )
            context.report({
              node: specifier,
              message: 'Use Spinner from @study/ui/spinner instead of a raw loader icon.'
            });
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && loadingAnimation.test(node.value))
          context.report({
            node,
            message: 'Keep loading animations in the shared @study/ui loading components.'
          });
      },
      TemplateElement(node) {
        if (loadingAnimation.test(node.value.raw))
          context.report({
            node,
            message: 'Keep loading animations in the shared @study/ui loading components.'
          });
      },
      IfStatement(node) {
        if (!web || !componentReturn(node)) return;

        if (loadingWhen(node.test, true)) checkReturns(node.consequent);

        if (node.alternate && loadingWhen(node.test, false)) checkReturns(node.alternate);
      },
      ConditionalExpression(node) {
        if (
          !web ||
          (!rendered(node) &&
            node.consequent.type !== 'JSXElement' &&
            node.alternate.type !== 'JSXElement')
        )
          return;

        if (loadingWhen(node.test, true)) requireIndicator(node.consequent);

        if (loadingWhen(node.test, false)) requireIndicator(node.alternate);
      },
      LogicalExpression(node) {
        if (!web || (!rendered(node) && !['JSXElement', 'JSXFragment'].includes(node.right.type)))
          return;

        const truth = node.operator === '&&';

        if (
          loadingWhen(node.left, truth) &&
          ['JSXElement', 'JSXFragment', 'Literal', 'Identifier'].includes(node.right.type)
        )
          requireIndicator(node.right);
      },
      JSXElement(node) {
        checkLoaderIcon(node);

        if (!web) return;

        const binding = imported(node.openingElement.name);

        if (binding?.source === 'react' && binding.name === 'Suspense') checkSuspense(node);

        checkBusyRegion(node);

        if (node.children.some(loadingMessage) && !indicator(node))
          context.report({ node: node.openingElement, message });
      }
    };
  }
});
