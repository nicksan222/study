import { defineRule } from 'vite-plus/lint/plugins';

import { propertyName } from '../effect-bindings.ts';
import {
  binding,
  constantDeclarator,
  imported,
  memberName,
  namedProperty
} from '../lexical-bindings.ts';

const durable = new Set(['materials', 'material_versions', 'sessions']);

const projectColumns = new Set(['project_id', 'projectId']);

const sqliteCore = /^drizzle-orm\/sqlite-core$/;

/** Follow local constants, preserving lexical shadowing and terminating alias cycles. */
function value(context: any, node: any, seen = new Set<any>()): any {
  if (!node || seen.has(node)) return node;

  seen.add(node);

  if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(node.type))
    return value(context, node.expression, seen);

  if (node.type !== 'Identifier') return node;

  const definition = binding(context, node)?.defs[0]?.node;

  return constantDeclarator(definition) && definition.id.type === 'Identifier'
    ? value(context, definition.init, seen)
    : node;
}

function factory(context: any, node: any, name: string): boolean {
  const resolved = value(context, node);

  return (
    imported(context, resolved, sqliteCore, name) ||
    (memberName(resolved) === name && imported(context, resolved.object, sqliteCore))
  );
}

function tableName(context: any, node: any): string | null {
  const resolved = value(context, node);

  if (resolved?.type !== 'CallExpression' || !factory(context, resolved.callee, 'sqliteTable'))
    return null;

  const name = value(context, resolved.arguments[0]);

  return name?.type === 'Literal' && typeof name.value === 'string' ? name.value : null;
}

function projectReference(context: any, node: any): boolean {
  if (node.type !== 'MemberExpression') return false;

  const object = value(context, node.object);

  return imported(context, object, /.*/, 'projects') || tableName(context, object) === 'projects';
}

function ownershipNode(context: any, node: any, seen = new Set<any>()): any {
  if (!node || seen.has(node)) return null;

  seen.add(node);

  const resolved = value(context, node);

  if (resolved !== node) return ownershipNode(context, resolved, seen);

  if (namedProperty(node) && projectColumns.has(propertyName(node.key) ?? '')) return node;

  if (projectReference(context, node)) return node;

  // A foreign key to a durable request is not ownership by that request's scope.
  if (tableName(context, node) !== null) return null;

  if (projectColumn(context, node)) return node;

  return childOwnership(context, node, seen);
}

function projectColumn(context: any, node: any): boolean {
  return (
    node.type === 'CallExpression' &&
    factory(context, node.callee, 'integer') &&
    projectColumns.has(value(context, node.arguments[0])?.value)
  );
}

function childOwnership(context: any, node: any, seen: Set<any>): any {
  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent') continue;

    const children = Array.isArray(child) ? child : [child];

    for (const entry of children) {
      if (!entry || typeof entry !== 'object' || !('type' in entry)) continue;

      const found = ownershipNode(context, entry, seen);

      if (found) return found;
    }
  }

  return null;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!/\/packages\/db\/src\/schema\//.test(context.filename.replaceAll('\\', '/'))) return {};

    return {
      CallExpression(node) {
        if (!durable.has(tableName(context, node) ?? '')) return;

        const owner = node.arguments.slice(1).find((argument) => ownershipNode(context, argument));

        if (owner)
          context.report({
            node: owner,
            message:
              'Materials, versions and sessions are independent library identities; organize them through project membership tables.'
          });
      }
    };
  }
});
