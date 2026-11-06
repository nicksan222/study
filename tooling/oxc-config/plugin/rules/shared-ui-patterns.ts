import { defineRule } from 'vite-plus/lint/plugins';
import type { ESTree } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';

const actions: Record<string, string> = { Retry: 'RetryButton', LibraryMore: 'LoadMoreButton' };

const selectionParts: Record<string, string> = {
  Empty: 'EmptyState for consistent empty-state hierarchy',
  Search: 'SearchField for labelled selection search',
  Material: 'Item to share item labels, icons and descriptions'
};

const settingRows: Record<string, string> = {
  '@study/ui/switch-control:SwitchControl': 'ToggleRow',
  '@study/ui/select-control:SelectControl': 'SelectRow',
  '@study/ui/number-control:NumberControl': 'NumberRow'
};

const dialogParts: Record<string, string> = {
  '@study/ui/dialog:DialogClose': 'DialogDismissButton from @study/ui/dialog-form-actions',
  '@study/ui/dialog:DialogHeader': 'DialogHeading from @study/ui/dialog-heading'
};

type Name = ESTree.JSXElement['openingElement']['name'];

type Identify = (name: Name) => string;

function content(node: ESTree.JSXElement) {
  return node.children.filter((child) => child.type !== 'JSXText' || child.value.trim());
}

function attribute(node: ESTree.JSXElement, name: string) {
  return node.openingElement.attributes.find(
    (item): item is ESTree.JSXAttribute => item.type === 'JSXAttribute' && item.name.name === name
  )?.value;
}

function literal(node: ESTree.JSXElement, name: string) {
  const value = attribute(node, name);

  return value?.type === 'Literal' ? value.value : undefined;
}

function translation(node: ESTree.Node): string | undefined {
  if (node.type !== 'JSXExpressionContainer' || node.expression.type !== 'CallExpression') return;

  const { callee, arguments: args } = node.expression;
  const name =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression'
        ? propertyName(callee.property)
        : undefined;
  const key = args[0];

  return name === 't' && key?.type === 'Literal' && typeof key.value === 'string'
    ? key.value
    : undefined;
}

function childNames(node: ESTree.JSXElement, identify: Identify) {
  return content(node).map((child) =>
    child.type === 'JSXElement' ? identify(child.openingElement.name) : ''
  );
}

function nativePattern(
  node: ESTree.JSXElement,
  tag: string,
  identify: Identify
): string | undefined {
  if (tag === 'details') return 'Disclosure from @study/ui/disclosure for expandable sections';

  if (tag === 'p' && literal(node, 'role') === 'status')
    return 'StatusMessage from @study/ui/status-message for operation feedback';

  if (
    tag === 'label' &&
    childNames(node, identify).some((name) =>
      ['@study/ui/input:Input', '@study/ui/textarea:Textarea'].includes(name)
    )
  )
    return 'Field from @study/ui/field for labelled text controls';
}

function selectionPattern(node: ESTree.JSXElement, tag: string): string | undefined {
  const prefix = '@study/ui/selection:SelectionSurface.';

  if (!tag.startsWith(prefix)) return;

  const part = tag.slice(prefix.length);

  if (selectionParts[part]) return `SelectionSurface.${selectionParts[part]}`;

  if (
    part === 'Header' &&
    childNames(node, (name) => (name.type === 'JSXIdentifier' ? name.name : '')).includes('h2')
  )
    return 'SelectionSurface.DetailHeader for selected-item headings';
}

function settingsPattern(
  node: ESTree.JSXElement,
  tag: string,
  identify: Identify
): string | undefined {
  if (tag !== '@study/ui/settings:Settings.Row') return;

  const children = childNames(node, identify);
  const row = children.length === 1 ? settingRows[children[0]] : undefined;

  return row ? `Settings.${row} for labelled preferences` : undefined;
}

function buttonPattern(node: ESTree.JSXElement, identify: Identify): string | undefined {
  const size = literal(node, 'size');

  if (typeof size === 'string' && size.startsWith('icon') && attribute(node, 'aria-label'))
    return 'IconButton from @study/ui/icon-button for labelled icon actions';

  const children = content(node);

  if (
    children.length === 2 &&
    childNames(node, identify).some((name) =>
      ['lucide-react:ArrowLeft', 'lucide-react:ArrowRight'].includes(name)
    )
  )
    return 'PreviousButton or NextButton from @study/ui/navigation-button for directional actions';

  const key = children.length === 1 ? translation(children[0]) : undefined;

  return key && actions[key]
    ? `${actions[key]} from @study/ui/action-button for this shared action`
    : undefined;
}

/** Binding-aware checks enforce UI scaffolding without constraining document prose or custom controls. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!webFile(context.filename)) return {};

    const bindings = effectBindings(context);
    const imports = new Map<ESTree.Node, string>();

    function identify(name: Name): string {
      if (name.type === 'JSXIdentifier') return imports.get(bindings.definition(name)) ?? name.name;

      if (name.type !== 'JSXMemberExpression') return '';

      const owner = identify(name.object);

      return owner.endsWith(':*')
        ? owner.slice(0, -1) + name.property.name
        : `${owner}.${name.property.name}`;
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return;

        for (const specifier of node.specifiers) {
          const name =
            specifier.type === 'ImportSpecifier' ? propertyName(specifier.imported) : '*';

          imports.set(specifier, `${node.source.value}:${name}`);
        }
      },
      JSXElement(node) {
        const tag = identify(node.openingElement.name);
        const pattern =
          dialogParts[tag] ??
          nativePattern(node, tag, identify) ??
          selectionPattern(node, tag) ??
          settingsPattern(node, tag, identify) ??
          (tag === '@study/ui/button:Button' ? buttonPattern(node, identify) : undefined);

        if (pattern) context.report({ node: node.openingElement, message: `Use ${pattern}.` });
      }
    };
  }
});
