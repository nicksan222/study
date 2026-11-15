/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Centralizes model execution and checkpoints feature generation inside workflow     │
 * │ activities.                                                                              │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Production server modules outside platform/ai importing AI SDKs (except definition-only  │
 * │ SDK types), agents/tools importing stores or database access, and non-runtime AI modules │
 * │ executing SDK generation. Feature generateAgent/streamAgent calls belong in workflow     │
 * │ activity execute bodies with non-null preflight and maxRetries: 0; activities own        │
 * │ retries.                                                                                 │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/src/platform/ai/agents.ts                                               │
 * │   import { generateText } from 'ai';                                                     │
 * │   generateText(options);                                                                 │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/src/features/sources/service.ts                                         │
 * │   import { generateText } from 'ai';                                                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import {
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

    if (!current || !serverProduction(context.filename)) return {};

    const inAi = current.startsWith('platform/ai/');
    const generationOwner = current === 'platform/ai/agents.ts';
    // This adapter delegates piece checkpoints to the runner; callers checkpoint final output.
    const contextOwner = current === 'platform/ai/context-preparation/agent.ts';
    const effects = effectBindings(context);
    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source) {
        if (inAi) context.report({ node, message: 'AI modules require literal module paths.' });

        return;
      }

      const target = targetPath(context.filename, source);
      const sdk = sdkModule(source);
      const db = /^@study\/db(?:\/|$)|^drizzle-orm(?:\/|$)/.test(source);
      const definitionType = current === 'platform/definitions/define-agent.ts' && typeOnly;
      let forbidden = sdk && !inAi && !definitionType;

      if (['agent', 'tool'].includes(featureRole(current) ?? ''))
        forbidden ||= storeImport(db, target);

      if (forbidden) context.report({ node, message: 'Import crosses the AI ownership boundary.' });
    });

    function sdkBinding(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (node.type === 'MemberExpression') return sdkBinding(node.object, seen);

      if (node.type !== 'Identifier') return false;

      return (
        binding(context, node)?.defs.some((def: any) => {
          const declaration = def.node;

          if (
            declaration.parent?.type === 'ImportDeclaration' &&
            declaration.parent.source.value === 'ai'
          ) {
            return (
              declaration.type === 'ImportNamespaceSpecifier' ||
              /^(?:ToolLoopAgent|generateText|generateObject|streamText|streamObject)$/.test(
                declaration.imported?.name ?? ''
              )
            );
          }

          return (
            declaration.type === 'VariableDeclarator' &&
            declaration.parent?.kind === 'const' &&
            sdkBinding(declaration.init, seen)
          );
        }) ?? false
      );
    }

    function agentNamespace(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      const def = binding(context, node)?.defs[0]?.node;

      if (def?.type === 'ImportNamespaceSpecifier')
        return targetPath(context.filename, def.parent.source.value) === 'platform/ai/agents';

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
        targetPath(context.filename, def.parent.source.value) === 'platform/ai/agents'
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

      if (!current.startsWith('features/') || featureRole(current) !== 'workflow') return false;

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
        effects.resolve(callee)?.replace(/^(?:unstable\/)?workflow[./]/, '') === 'Activity.make'
      );
    }

    function sdkAgentMethod(node: any): boolean {
      const object =
        node.callee.type === 'MemberExpression' &&
        /^(?:generate|stream)$/.test(node.callee.property.name)
          ? node.callee.object
          : null;
      const definition = binding(context, object)?.defs[0]?.node;
      const init = definition?.init;
      const agent = init?.type === 'NewExpression' && sdkBinding(init.callee);

      return agent;
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

        if (!generationOwner && agentBinding(node.callee)) checkGeneration(node);

        const agent = sdkAgentMethod(node);

        if (inAi && !generationOwner && (sdkBinding(node.callee) || agent))
          context.report({ node, message: 'AI generation belongs in AI runtime.' });
      },
      NewExpression(node: any) {
        if (inAi && !generationOwner && sdkBinding(node.callee))
          context.report({ node, message: 'AI generation belongs in AI runtime.' });
      }
    };
  }
});

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
