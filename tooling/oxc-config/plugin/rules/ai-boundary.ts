/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Centralizes native model execution and checkpointed feature generation.            │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Retired ai and @ai-sdk imports, provider packages outside the server, native model       │
 * │ generation outside shared runtime/providers, and feature model work without Activity     │
 * │ ownership, preflight checks and activity-owned retries. Agents cannot import stores.     │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/src/platform/ai/agents.ts                                               │
 * │   import { LanguageModel } from 'effect/ai';                                             │
 * │   LanguageModel.streamText(options);                                                     │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/src/features/sources/service.ts                                         │
 * │   import { LanguageModel } from 'effect/ai';                                             │
 * │   LanguageModel.generateText(options);                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import {
  importTarget,
  canonicalImport,
  featureRole,
  moduleEdges,
  serverPath,
  targetPath
} from '../architecture-imports.ts';
import { effectBindings, serverProduction } from '../effect-bindings.ts';
import {
  binding,
  memberName as property,
  constantDeclarator,
  enterNode
} from '../lexical-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = serverPath(context.filename);

    const production = serverProduction(context.filename);
    const server = Boolean(current);
    const generationOwner = current === 'platform/ai/agents.ts';
    const nativeOwner = generationOwner || current?.startsWith('platform/ai/providers/');

    const inAi = current?.startsWith('platform/ai/') ?? false;
    // This adapter delegates piece checkpoints to the runner; callers checkpoint final output.
    const contextOwner = current === 'platform/ai/context-preparation/agent.ts';
    const effects = effectBindings(context);
    const edges = moduleEdges(context, (node, source) => {
      if (!source) {
        if (inAi) context.report({ node, message: 'AI modules require literal module paths.' });

        return;
      }

      const target = targetPath(context.filename, source);
      const forbidden =
        forbiddenModelImport(source, server) ||
        featureStoreImport(current, production, source, target);

      if (forbidden) context.report({ node, message: 'Import crosses the AI ownership boundary.' });
    });

    function nativeGeneration(node: any): boolean {
      const resolved = effects.resolve(node)?.replaceAll('/', '.');

      return (
        /^ai\.LanguageModel\.(?:generateText|generateObject|streamText)$/.test(resolved ?? '') ||
        (node?.type === 'MemberExpression' &&
          /^(?:generateText|generateObject|streamText)$/.test(property(node) ?? '') &&
          nativeInstance(node.object))
      );
    }

    function nativeInstance(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (node.type === 'YieldExpression') {
        const target =
          node.argument?.type === 'CallExpression' ? node.argument.callee : node.argument;

        return /^ai\.LanguageModel\.(?:LanguageModel|make)$/.test(
          effects.resolve(target)?.replaceAll('/', '.') ?? ''
        );
      }

      const def = binding(context, node)?.defs[0]?.node;

      return constantDeclarator(def) && nativeInstance(def.init, seen);
    }

    function agentNamespace(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      const def = binding(context, node)?.defs[0]?.node;

      if (def?.type === 'ImportNamespaceSpecifier')
        return importTarget(context, def, 'generateAgent') === 'platform/ai/agents';

      return constantDeclarator(def) && agentNamespace(def.init, seen);
    }

    function agentBinding(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (agentMember(node)) return agentNamespace(node.object);

      const def = binding(context, node)?.defs[0]?.node;

      if (def?.type === 'ImportSpecifier') return namedAgent(def);

      if (constantDeclarator(def) && def.id.type === 'ObjectPattern')
        return destructuredAgent(node, def);

      return constantDeclarator(def) && agentBinding(def.init, seen);
    }

    function namedAgent(def: any): boolean {
      return (
        ['generateAgent', 'streamAgent'].includes(def.imported.name ?? def.imported.value) &&
        importTarget(context, def) === 'platform/ai/agents'
      );
    }

    function destructuredAgent(node: any, def: any): boolean {
      const item = def.id.properties.find(
        (p: any) => p.type === 'Property' && p.value.name === node.name
      );

      return (
        item &&
        ['generateAgent', 'streamAgent'].includes(item.key.name ?? item.key.value) &&
        agentNamespace(def.init)
      );
    }

    function constant(node: any, seen = new Set<any>()): any {
      if (!enterNode(node, seen)) return node;

      if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression')
        return constant(node.expression, seen);

      if (node.type === 'Identifier') {
        const def = binding(context, node)?.defs[0]?.node;

        if (constantDeclarator(def)) return constant(def.init, seen);
      }

      return node;
    }

    function requestOptions(node: any): boolean {
      const options = constant(node.arguments[2]);

      if (options?.type !== 'ObjectExpression') return false;

      const field = (key: string) =>
        constant(
          options.properties.find(
            (p: any) => p.type === 'Property' && (p.key.name ?? p.key.value) === key
          )?.value
        );
      const retries = field('maxRetries');

      return (
        validPreflight(field('preflight')) && retries?.type === 'Literal' && retries.value === 0
      );
    }

    function validPreflight(node: any): boolean {
      return (
        !!node &&
        !(node.type === 'Literal' && node.value == null) &&
        !(node.type === 'Identifier' && node.name === 'undefined')
      );
    }

    const checkpointed = (node: any): boolean => {
      if (contextOwner) return true;

      if (!current?.startsWith('features/')) return false;

      const procedure = /^features\/[^/]+\/procedures\//.test(current);

      if (!procedure && featureRole(current) !== 'workflow') return false;

      for (let parent = node.parent; parent; parent = parent.parent) {
        if (activityExecute(parent)) return true;
      }

      return false;
    };

    function activityExecute(parent: any): boolean {
      if (
        parent.type === 'Property' &&
        (parent.key.name ?? parent.key.value) === 'execute' &&
        parent.parent?.type === 'ObjectExpression'
      ) {
        const call = parent.parent.parent;

        if (call?.type === 'CallExpression' && checkpointConstructor(call.callee)) return true;
      }

      return false;
    }

    function checkpointConstructor(callee: any): boolean {
      return (
        canonicalImport(context, callee, 'define-activity', 'defineActivity') ||
        canonicalImport(context, callee, 'define-activity', 'resumableActivity') ||
        canonicalImport(context, callee, 'define-procedure', 'defineProcedure') ||
        effects.resolve(callee)?.replace(/^(?:unstable\/)?workflow[./]/, '') === 'Activity.make'
      );
    }

    function checkGeneration(node: any) {
      if (!checkpointed(node))
        context.report({
          node,
          message: 'Agent generation belongs in a native workflow activity execute effect.'
        });
      else if (!requestOptions(node))
        context.report({
          node,
          message:
            'Workflow generation requires a request preflight and maxRetries: 0; activities own retries.'
        });
    }

    return {
      ...edges,
      ImportDeclaration(node: any) {
        edges.ImportDeclaration(node);
        effects.imports(node);
      },
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (production && !generationOwner && agentBinding(node.callee)) checkGeneration(node);

        if (production && !nativeOwner && nativeGeneration(node.callee))
          context.report({
            node,
            message: 'Native model generation belongs in the shared AI runtime or providers.'
          });
      }
    };
  }
});

function forbiddenModelImport(source: string, server: boolean): boolean {
  return sdkModule(source) || (source.startsWith('@effect/ai-') && !server);
}

function featureStoreImport(
  current: string | null,
  production: boolean,
  source: string,
  target: string | null
): boolean {
  if (!production || !current || !['agent', 'tool'].includes(featureRole(current) ?? ''))
    return false;

  return storeImport(/^@study\/db(?:\/|$)|^drizzle-orm(?:\/|$)/.test(source), target);
}

function storeImport(db: boolean, target: string | null): boolean {
  return db || (!!target && featureRole(target) === 'store');
}

function sdkModule(source: string): boolean {
  return source === 'ai' || source.startsWith('ai/') || source.startsWith('@ai-sdk/');
}

function agentMember(node: any): boolean {
  return (
    node.type === 'MemberExpression' &&
    ['generateAgent', 'streamAgent'].includes(property(node) ?? '')
  );
}
