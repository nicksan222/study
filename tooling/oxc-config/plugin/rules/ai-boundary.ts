import { defineRule } from 'vite-plus/lint/plugins';

import { featureRole, moduleEdges, serverPath, targetPath } from '../architecture-imports.ts';
import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { binding, property } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = serverPath(context.filename);

    if (!current || !serverProduction(context.filename)) return {};

    const inAi = current.startsWith('platform/ai/');
    const generationOwner = current === 'platform/ai/agents.ts';
    const effects = effectBindings(context);
    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source) {
        if (inAi) context.report({ node, message: 'AI modules require literal module paths.' });

        return;
      }

      const target = targetPath(context.filename, source);
      const sdk = source === 'ai' || source.startsWith('ai/') || source.startsWith('@ai-sdk/');
      const db = /^@study\/db(?:\/|$)|^drizzle-orm(?:\/|$)/.test(source);
      const definitionType = current === 'platform/definitions/define-agent.ts' && typeOnly;
      let forbidden = sdk && !inAi && !definitionType;

      if (['agent', 'tool'].includes(featureRole(current) ?? ''))
        forbidden ||= db || (!!target && featureRole(target) === 'store');

      if (forbidden) context.report({ node, message: 'Import crosses the AI ownership boundary.' });
    });

    function sdkBinding(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'MemberExpression') return sdkBinding(node.object, seen);

      if (node.type !== 'Identifier') return false;

      let scope: ReturnType<typeof context.sourceCode.getScope> | null =
        context.sourceCode.getScope(node);

      while (scope) {
        const variable = scope.set.get(node.name);

        if (variable)
          return variable.defs.some((def: any) => {
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
          });

        scope = scope.upper;
      }

      return false;
    }

    function agentNamespace(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);
      const def = binding(context, node)?.defs[0]?.node;

      if (def?.type === 'ImportNamespaceSpecifier')
        return targetPath(context.filename, def.parent.source.value) === 'platform/ai/agents';

      return (
        def?.type === 'VariableDeclarator' &&
        def.parent?.kind === 'const' &&
        agentNamespace(def.init, seen)
      );
    }

    function agentBinding(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (
        node.type === 'MemberExpression' &&
        ['generateAgent', 'streamAgent'].includes(property(node) ?? '')
      ) {
        return agentNamespace(node.object);
      }

      const def = binding(context, node)?.defs[0]?.node;

      if (def?.type === 'ImportSpecifier')
        return (
          ['generateAgent', 'streamAgent'].includes(def.imported.name ?? def.imported.value) &&
          targetPath(context.filename, def.parent.source.value) === 'platform/ai/agents'
        );

      if (
        def?.type === 'VariableDeclarator' &&
        def.parent?.kind === 'const' &&
        def.id.type === 'ObjectPattern'
      ) {
        const item = def.id.properties.find(
          (p: any) => p.type === 'Property' && p.value.name === node.name
        );

        return (
          item &&
          ['generateAgent', 'streamAgent'].includes(item.key.name ?? item.key.value) &&
          agentNamespace(def.init)
        );
      }

      return (
        def?.type === 'VariableDeclarator' &&
        def.parent?.kind === 'const' &&
        agentBinding(def.init, seen)
      );
    }

    function constant(node: any, seen = new Set<any>()): any {
      if (!node || seen.has(node)) return node;

      seen.add(node);

      if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression')
        return constant(node.expression, seen);

      if (node.type === 'Identifier') {
        const def = binding(context, node)?.defs[0]?.node;

        if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const')
          return constant(def.init, seen);
      }

      return node;
    }

    function requestOptions(node: any): boolean {
      const options = constant(node.arguments[2]);

      if (options?.type !== 'ObjectExpression') return false;

      const field = (key: string) =>
        options.properties.find(
          (p: any) => p.type === 'Property' && (p.key.name ?? p.key.value) === key
        )?.value;
      const preflight = constant(field('preflight'));
      const retries = constant(field('maxRetries'));

      return (
        !!preflight &&
        !(preflight.type === 'Literal' && preflight.value == null) &&
        !(preflight.type === 'Identifier' && preflight.name === 'undefined') &&
        retries?.type === 'Literal' &&
        retries.value === 0
      );
    }

    const checkpointed = (node: any): boolean => {
      if (!current.startsWith('features/') || featureRole(current) !== 'workflow') return false;

      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          parent.type === 'Property' &&
          (parent.key.name ?? parent.key.value) === 'execute' &&
          parent.parent?.type === 'ObjectExpression'
        ) {
          const call = parent.parent.parent;

          if (
            call?.type === 'CallExpression' &&
            effects.resolve(call.callee)?.replace(/^(?:unstable\/)?workflow[./]/, '') ===
              'Activity.make'
          )
            return true;
        }
      }

      return false;
    };

    return {
      ...edges,
      ImportDeclaration(node: any) {
        edges.ImportDeclaration(node);
        effects.imports(node);
      },
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (!generationOwner && agentBinding(node.callee)) {
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

        const object =
          node.callee.type === 'MemberExpression' &&
          /^(?:generate|stream)$/.test(node.callee.property.name)
            ? node.callee.object
            : null;
        const variable = object?.type === 'Identifier' ? context.sourceCode.getScope(object) : null;
        let scope = variable;

        while (scope && !scope.set.has(object.name)) scope = scope.upper;

        const definition: any = scope?.set.get(object?.name)?.defs[0]?.node;
        const init = definition?.init;
        const agent = init?.type === 'NewExpression' && sdkBinding(init.callee);

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
