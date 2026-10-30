import {
  binding,
  imported,
  memberName as property,
  constantDeclarator,
  enterNode
} from './lexical-bindings.ts';

export function requireBindings(context: any) {
  function createRequire(node: any, seen = new Set<any>()): boolean {
    if (!enterNode(node, seen)) return false;

    if (imported(context, node, /^(?:node:)?module$/, 'createRequire')) return true;

    if (property(node) === 'createRequire' && imported(context, node.object, /^(?:node:)?module$/))
      return true;

    const definition = binding(context, node)?.defs[0]?.node;

    return constantDeclarator(definition) && createRequire(definition.init, seen);
  }

  function requireFunction(node: any, seen = new Set<any>()): boolean {
    if (!enterNode(node, seen)) return false;

    if (globalRequire(node)) return true;

    if (node.type === 'CallExpression' && createRequire(node.callee)) return true;

    const definition = binding(context, node)?.defs[0]?.node;

    return constantDeclarator(definition) && requireFunction(definition.init, seen);
  }

  function globalRequire(node: any): boolean {
    if (
      node.type === 'Identifier' &&
      node.name === 'require' &&
      !binding(context, node)?.defs.length
    )
      return true;

    if (
      property(node) === 'require' &&
      node.object.type === 'Identifier' &&
      ['module', 'globalThis', 'global'].includes(node.object.name) &&
      !binding(context, node.object)?.defs.length
    )
      return true;

    return false;
  }

  return requireFunction;
}
