import { defineRule } from 'vite-plus/lint/plugins';

import {
  canonicalImport,
  featureRole,
  importedValue,
  moduleEdges,
  targetPath
} from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';
import { binding, property } from './synchronous-transactions.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const server = production(path);
    const consumer =
      /\/(?:packages\/contracts|packages\/ui|apps\/web)\//.test(path) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);

    if (!server && !consumer) return {};

    const effects = effectBindings(context);
    const workflowOwner = path.endsWith('/apps/server/src/platform/definitions/define-workflow.ts');
    const engineOwner = path.endsWith('/apps/server/src/platform/workflows/engine.ts');
    const publicationOwner = path.endsWith('/apps/server/src/platform/workflows/publication.ts');
    const activityOwner =
      path.endsWith('/apps/server/src/platform/workflows/retry.ts') ||
      /\/apps\/server\/src\/platform\/(?:definitions\/define-workflow|workflows\/(?:engine|store))\.ts$/.test(
        path
      ) ||
      (/\/features\//.test(path) && featureRole(path) === 'workflow');

    function ownershipKey(node: any, seen = new Set<any>()): 'activity' | 'publication' | null {
      if (!node || seen.has(node)) return null;

      seen.add(node);
      const classify = (name: string, source: string | null) => {
        if (name === 'WorkflowActivityOwner' && source === 'platform/workflows/ownership')
          return 'activity' as const;

        if (
          name === 'PublicationGuard' &&
          ['platform/workflows/ownership', 'platform/workflows/publication'].includes(source ?? '')
        )
          return 'publication' as const;

        return null;
      };
      const member = (object: any, name: string) => {
        const def = binding(context, resolveValue(context, object))?.defs[0]?.node;

        return def?.type === 'ImportNamespaceSpecifier'
          ? classify(name, targetPath(context.filename, def.parent.source.value))
          : null;
      };

      if (node.type === 'Identifier') {
        const def = binding(context, node)?.defs[0]?.node;

        if (def?.type === 'ImportSpecifier')
          return classify(
            def.imported.name ?? def.imported.value,
            targetPath(context.filename, def.parent.source.value)
          );

        if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const') {
          if (def.id.type === 'ObjectPattern') {
            const prop = def.id.properties.find(
              (p: any) =>
                p.type === 'Property' && (p.value.name ?? p.value.left?.name) === node.name
            );

            return prop ? member(def.init, prop.key.name ?? prop.key.value) : null;
          }

          return ownershipKey(def.init, seen);
        }

        return null;
      }

      if (node.type === 'MemberExpression')
        return member(node.object, node.computed ? node.property.value : node.property.name);

      if (
        [
          'TSAsExpression',
          'TSSatisfiesExpression',
          'TSNonNullExpression',
          'ParenthesizedExpression'
        ].includes(node.type)
      )
        return ownershipKey(node.expression, seen);

      return null;
    }

    function nativeLayer(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);
      const def = binding(context, node)?.defs[0]?.node;

      if (
        def?.type === 'VariableDeclarator' &&
        def.parent?.kind === 'const' &&
        def.id.type === 'Identifier'
      )
        return nativeLayer(def.init, seen);

      if (
        def?.type === 'VariableDeclarator' &&
        def.parent?.kind === 'const' &&
        def.id.type === 'ObjectPattern'
      ) {
        const item = def.id.properties.find(
          (part: any) => part.type === 'Property' && part.value?.name === node.name
        );
        const key = item?.key;

        if (key && (!item.computed || key.type === 'Literal'))
          return nativeLayer(
            { type: 'MemberExpression', object: def.init, property: key, computed: item.computed },
            seen
          );
      }

      if (/^(?:rpc[./])?RpcGroup\.toLayer$/.test(effects.resolve(node) ?? '')) return true;

      const imported = importedValue(context, node);

      if (imported?.name.endsWith('.toLayer')) {
        if (/^@study\/contracts\/.+\/rpc$/.test(imported.source)) return true;

        if (
          imported.target &&
          /^features\/[^/]+\//.test(imported.target) &&
          featureRole(imported.target) === 'workflow'
        )
          return true;
      }

      const resolved = resolveValue(context, node);

      if (property(resolved) !== 'toLayer') return false;

      const object = resolveValue(context, resolved.object);

      return (
        object?.type === 'CallExpression' &&
        (canonicalImport(context, object.callee, 'define-workflow', 'defineWorkflow') ||
          /^(?:rpc[./])?RpcGroup\.make$/.test(effects.resolve(object.callee) ?? ''))
      );
    }

    const nameOf = (node: any) =>
      effects.resolve(node)?.replace(/^(?:unstable\/)?workflow[./]/, '') ?? '';
    const edges = moduleEdges(context, (node, source) => {
      if (consumer && source && /^effect\/(?:unstable\/)?workflow(?:\/|$)/.test(source))
        context.report({
          node,
          message: 'Workflow infrastructure cannot be imported into contracts or browser packages.'
        });
    });

    return {
      ...edges,
      ImportDeclaration(node: any) {
        effects.imports(node);
        edges.ImportDeclaration(node);
      },
      CallExpression(node: any) {
        edges.CallExpression(node);
        const name = nameOf(node.callee);

        if (/\/features\//.test(path) && nativeLayer(node.callee))
          context.report({
            node,
            message: 'Use defineRpc or defineWorkflowHandler for native handler registration.'
          });

        if (
          !engineOwner &&
          /^(?:Effect\.provideService(?:Effect)?|Layer\.(?:succeed|effect|sync)|Context\.(?:make|add))$/.test(
            name
          )
        ) {
          const index =
            (name.startsWith('Effect.') || name === 'Context.add') && node.arguments.length === 3
              ? 1
              : 0;

          const capability = ownershipKey(node.arguments[index]);

          if (capability && !(publicationOwner && capability === 'publication'))
            context.report({
              node,
              message: 'Only the canonical workflow owner may grant this capability.'
            });
        }

        if (
          (name === 'Workflow.make' && !workflowOwner) ||
          (name === 'WorkflowEngine.makeUnsafe' && !engineOwner) ||
          (name === 'Activity.make' && !activityOwner)
        )
          context.report({
            node,
            message:
              'Workflow and activity constructors belong to their application or workflow owner.'
          });

        if (/^(?:WorkflowEngine\.layerMemory|WorkflowMemory(?:\.|$))/.test(name))
          context.report({
            node,
            message: 'Production workflows cannot use memory infrastructure.'
          });
      },
      MemberExpression(node: any) {
        if (node.parent?.type === 'CallExpression' && node.parent.callee === node) return;

        const name = nameOf(node);

        if (
          /^(?:WorkflowEngine\.layerMemory|WorkflowMemory(?:\.|$))/.test(name) &&
          !(node.parent?.type === 'MemberExpression' && node.parent.object === node)
        )
          context.report({
            node,
            message: 'Production workflows cannot use memory infrastructure.'
          });
      }
    };
  }
});
