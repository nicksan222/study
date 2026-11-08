import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { binding } from '../lexical-bindings.ts';

const retiredNames =
  /^(?:SessionId|sessionIdSchema|(?:StudyDocument|studyDocument)(?:[A-Z]\w*)?|(?:apply|keep)DocumentProposal|(?:request|publish|retry)DocumentTransform|SidebarTurnIntoDoc)$/;

const retiredCaches = new Set(['document-creation', 'document-drafts', 'document-restore-attempt']);

const pageTypes = new Set(['Page', 'PageSummary', 'PageVersion', 'PageId', 'PageVersionId']);

const pageSchemas = new Set(['pageIdSchema', 'pageVersionIdSchema']);

const schemaWrappers = new Set([
  'Schema.Array',
  'Schema.NullOr',
  'Schema.optional',
  'Schema.optionalKey'
]);

const contracts = /^@study\/contracts\/(?:ids$|pages(?:\/|$))/;

function activeFile(filename: string): boolean {
  return (
    /\/(?:apps\/(?:server|web)\/src|packages\/(?:contracts|db|ui|localization)\/src)\//.test(
      filename
    ) && !/\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests|__tests__)\//.test(filename)
  );
}

function noteDomain(filename: string): boolean {
  return /\/apps\/web\/src\/(?:app\/shell|features\/(?:note-workspace|pages)|pages\/notes)\/|\/features\/(?:notes|pages)\/|\/contracts\/src\/(?:notes|pages)\/|\/db\/src\/schema\/(?:notes|note-[^/]+)\.|\/ui\/src\/components\/note-/.test(
    filename
  );
}

function pageDomain(filename: string): boolean {
  return /\/features\/(?:notes|pages|note-workspace)\/|\/contracts\/src\/pages\/|\/localization\/src\//.test(
    filename
  );
}

function propertyKey(node: any): string | undefined {
  return node?.type === 'Identifier' ? node.name : node?.value;
}

function importedEntity(context: any, node: any, names: ReadonlySet<string>): boolean {
  return Boolean(
    binding(context, node)?.defs.some((definition: any) => {
      const specifier = definition.node;

      return (
        contracts.test(specifier.parent?.source?.value ?? '') &&
        names.has(propertyKey(specifier.imported) ?? '')
      );
    })
  );
}

function namespaceMember(node: any): { object: any; name: string } | undefined {
  if (node?.type === 'TSQualifiedName') return { object: node.left, name: node.right.name };

  if (node?.type !== 'MemberExpression') return;

  if (node.computed && node.property.type !== 'Literal') return;

  return { object: node.object, name: propertyKey(node.property) ?? '' };
}

function namespacedEntity(context: any, node: any, names: ReadonlySet<string>): boolean {
  const member = namespaceMember(node);

  if (!member || !names.has(member.name)) return false;

  return Boolean(
    binding(context, member.object)?.defs.some(
      (definition: any) =>
        definition.node.type === 'ImportNamespaceSpecifier' &&
        contracts.test(definition.node.parent?.source?.value ?? '')
    )
  );
}

function nullableType(node: any): boolean {
  return (
    ['TSNullKeyword', 'TSUndefinedKeyword'].includes(node.type) ||
    (node.type === 'TSLiteralType' && node.literal.value === null)
  );
}

function nullablePage(context: any, node: any): boolean {
  const members = node.types.filter((type: any) => !nullableType(type));

  return members.length > 0 && members.every((type: any) => pageType(context, type));
}

function pageType(context: any, node: any): boolean {
  switch (node?.type) {
    case 'TSTypeAnnotation':
      return pageType(context, node.typeAnnotation);
    case 'TSArrayType':
      return pageType(context, node.elementType);
    case 'TSTypeOperator':
      return node.operator === 'readonly' && pageType(context, node.typeAnnotation);
    case 'TSTypeReference':
      return pageReference(context, node);
    case 'TSUnionType':
      return nullablePage(context, node);
    default:
      return false;
  }
}

function pageReference(context: any, node: any): boolean {
  if (namespacedEntity(context, node.typeName, pageTypes)) return true;

  if (importedEntity(context, node.typeName, pageTypes)) return true;

  return (
    ['Array', 'ReadonlyArray'].includes(node.typeName?.name) &&
    !binding(context, node.typeName)?.defs.length &&
    pageType(context, node.typeArguments?.params?.[0])
  );
}

function pageSchema(context: any, node: any, effects: ReturnType<typeof effectBindings>): boolean {
  if (importedEntity(context, node, pageSchemas) || namespacedEntity(context, node, pageSchemas))
    return true;

  if (node?.type !== 'CallExpression') return false;

  const wrapper = effects.resolve(node.callee);

  return schemaWrappers.has(wrapper ?? '') && pageSchema(context, node.arguments[0], effects);
}

function legacyName(name: string, filename: string): boolean {
  if (retiredNames.test(name)) return true;

  if (!noteDomain(filename) || name === 'sessionStorage') return false;

  return /^(?:Sessions?|sessions?)(?:[A-Z_]|$)/.test(name);
}

function propertyLiteral(node: any): boolean {
  const parent = node.parent;

  return (
    (parent?.type === 'Property' && parent.key === node) ||
    (parent?.type === 'MemberExpression' && parent.property === node && parent.computed)
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!activeFile(filename)) return {};

    const effects = effectBindings(context);
    const reported = new Set<number>();
    const report = (node: any) => {
      if (reported.has(node.range[0])) return;

      reported.add(node.range[0]);
      context.report({
        node,
        message:
          'Use Notes and Pages for study entities; Document is the canonical source content shape.'
      });
    };

    return {
      ImportDeclaration: effects.imports,
      Identifier(node: any) {
        if (legacyName(node.name, filename)) report(node);
        else if (/^documents?$/.test(node.name) && pageType(context, node.typeAnnotation))
          report(node);
      },
      TSPropertySignature(node: any) {
        if (
          /^documents?$/.test(propertyKey(node.key) ?? '') &&
          pageType(context, node.typeAnnotation)
        )
          report(node.key);
      },
      Property(node: any) {
        if (
          /^documents?$/.test(propertyKey(node.key) ?? '') &&
          pageSchema(context, node.value, effects)
        )
          report(node.key);
      },
      Literal(node: any) {
        if (typeof node.value !== 'string') return;

        if (propertyLiteral(node) && legacyName(node.value, filename)) report(node);
        else if (retiredNames.test(node.value) || retiredCaches.has(node.value)) report(node);
        else if (
          pageDomain(filename) &&
          /\b(?:authored documents?|Document title|Turn into doc)\b/i.test(node.value)
        )
          report(node);
      },
      TemplateLiteral(node: any) {
        if (!pageDomain(filename) || node.parent?.type !== 'Property') return;

        if (propertyKey(node.parent.key) !== 'filename') return;

        if (node.quasis[0]?.value.raw.startsWith('document-')) report(node);
      }
    };
  }
});
