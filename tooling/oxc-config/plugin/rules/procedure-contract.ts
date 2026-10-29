import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import type { ESTree, Scope } from 'vite-plus/lint/plugins';
import { defineRule } from 'vite-plus/lint/plugins';

type ImportBinding = ESTree.ImportSpecifier | ESTree.ImportNamespaceSpecifier;

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const server = filename.includes('/apps/server/src/');
    const procedures =
      filename.includes('/apps/server/src/procedures/') &&
      filename.endsWith('.ts') &&
      !filename.endsWith('.test.ts');
    const folderRoleCandidate = filename.match(
      /\/packages\/server\/src\/procedures\/[^/]+\/[^/]+\/(index|procedure|input|output)\.ts$/
    )?.[1];
    const folderRole = folderRoleCandidate;
    const schemaFile = folderRole === 'input' || folderRole === 'output';
    const schemaContractFile =
      schemaFile ||
      (filename.includes('/apps/server/src/shared/') && filename.endsWith('/schemas.ts'));
    const folderProcedureFile = folderRole === 'procedure';
    const folderIndexFile = folderRole === 'index';
    const endpointFolderIndexFile =
      folderIndexFile && existsSync(resolve(dirname(filename), 'procedure.ts'));

    if (!server || filename.endsWith('/runtime/trpc.ts')) return {};

    const routerFile = filename.endsWith('/router.ts');

    const publicNames = new Map<string, ImportBinding>();
    const routerNames = new Map<string, ImportBinding>();
    const trpcNamespaces = new Map<string, ImportBinding>();
    const inputValidators = new Map<string, ImportBinding>();
    const outputValidators = new Map<string, ImportBinding>();
    const effectSchemas = new Map<string, ImportBinding>();
    const effectNamespaces = new Map<string, ImportBinding>();
    const imports = new Map<string, ImportBinding>();
    const message =
      'Declare endpoints as export const run = publicProcedure.input(schema).query/mutation/subscription(handler), and compose routers from imported endpoints or routers.';

    function bound(node: ESTree.Node, names: Map<string, ImportBinding>): boolean {
      if (node.type !== 'Identifier' || !names.has(node.name)) return false;

      let scope: Scope | null = context.sourceCode.getScope(node);

      while (scope) {
        const variable = scope.set.get(node.name);

        if (variable)
          return variable.defs.some((definition) => definition.node === names.get(node.name));

        scope = scope.upper;
      }

      return false;
    }

    function procedureSource(source: string, imported: string): boolean {
      const root = filename.slice(
        0,
        filename.indexOf('/apps/server/src/') + '/apps/server/src/'.length
      );
      const target = source.startsWith('#server/')
        ? resolve(root, source.slice('#server/'.length))
        : source.startsWith('.')
          ? resolve(dirname(filename), source)
          : '';
      const path = relative(root, target).replaceAll('\\', '/');
      const targetsEndpointImplementation =
        /(?:^|\/)procedures\/[^/]+\/[^/]+\/(?:procedure|input|output)(?:\.ts)?$/.test(path) ||
        (existsSync(target) &&
          existsSync(resolve(target, 'index.ts')) &&
          !source.endsWith('/index.ts'));

      return (
        path.startsWith('procedures/') &&
        !targetsEndpointImplementation &&
        (imported === 'run' ? !/\/router(?:\.ts)?$/.test(path) : /\/router(?:\.ts)?$/.test(path))
      );
    }

    // These helpers inspect syntax, not the behavior of a handler or schema.
    function member(node: ESTree.Expression, property: string): boolean {
      return (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === property
      );
    }

    function effectSchemaNamespace(node: ESTree.Expression | null | undefined): boolean {
      if (!node) return false;

      if (node?.type === 'Identifier') return bound(node, effectSchemas);

      return (
        node?.type === 'MemberExpression' &&
        member(node, 'Schema') &&
        node.object.type === 'Identifier' &&
        bound(node.object, effectNamespaces)
      );
    }

    function forbiddenSchemaPattern(node: ESTree.Node): boolean {
      return (
        node?.type === 'ObjectPattern' &&
        node.properties.some(
          (property) =>
            property.type === 'Property' &&
            ['Any', 'Unknown', 'optionalKey'].includes(
              property.key.type === 'Literal'
                ? typeof property.key.value === 'string'
                  ? property.key.value
                  : ''
                : !property.computed && property.key.type === 'Identifier'
                  ? property.key.name
                  : ''
            )
        )
      );
    }

    function reportForbiddenSchemaPattern(node: ESTree.Node): void {
      context.report({
        node,
        message:
          'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
      });
    }

    function canonical(node: ESTree.Expression | null | undefined): boolean {
      if (
        node?.type !== 'CallExpression' ||
        node.arguments.length !== 1 ||
        node.callee.type !== 'MemberExpression' ||
        !['query', 'mutation', 'subscription'].some((name) => member(node.callee, name))
      )
        return false;

      const input = node.callee.object;

      return (
        input?.type === 'CallExpression' &&
        input.arguments.length === 1 &&
        input.callee.type === 'MemberExpression' &&
        member(input.callee, 'input') &&
        input.callee.object.type === 'Identifier' &&
        bound(input.callee.object, publicNames)
      );
    }

    function folderCanonical(node: ESTree.Expression | null | undefined): boolean {
      if (
        node?.type !== 'CallExpression' ||
        node.arguments.length !== 1 ||
        node.callee.type !== 'MemberExpression' ||
        !['query', 'mutation', 'subscription'].some((name) => member(node.callee, name))
      )
        return false;

      const output = node.callee.object;

      if (
        output?.type !== 'CallExpression' ||
        output.arguments.length !== 1 ||
        output.callee.type !== 'MemberExpression' ||
        !member(output.callee, 'output') ||
        !bound(output.arguments[0], outputValidators)
      )
        return false;

      const input = output.callee.object;

      return (
        input?.type === 'CallExpression' &&
        input.arguments.length === 1 &&
        input.callee.type === 'MemberExpression' &&
        member(input.callee, 'input') &&
        bound(input.arguments[0], inputValidators) &&
        input.callee.object.type === 'Identifier' &&
        bound(input.callee.object, publicNames)
      );
    }

    function canonicalFolderIndex(node: ESTree.Program): boolean {
      const exported = new Set<string>();

      for (const statement of node.body) {
        if (
          statement.type !== 'ExportNamedDeclaration' ||
          statement.declaration ||
          !statement.source
        )
          return false;

        const source = statement.source.value;

        for (const specifier of statement.specifiers) {
          if (
            specifier.type !== 'ExportSpecifier' ||
            specifier.local.type !== 'Identifier' ||
            specifier.exported.type !== 'Identifier' ||
            specifier.local.name !== specifier.exported.name
          )
            return false;

          const name = specifier.exported.name;

          if (name === 'run') {
            if (
              source !== './procedure.ts' ||
              statement.exportKind === 'type' ||
              specifier.exportKind === 'type' ||
              exported.has(name)
            )
              return false;
          } else if (name === 'Input' || name === 'Output') {
            const expectedSource = name === 'Input' ? './input.ts' : './output.ts';

            if (
              source !== expectedSource ||
              (statement.exportKind !== 'type' && specifier.exportKind !== 'type') ||
              exported.has(name)
            )
              return false;
          } else return false;

          exported.add(name);
        }
      }

      return exported.size === 3 && ['run', 'Input', 'Output'].every((name) => exported.has(name));
    }

    return {
      Program(node) {
        if (folderIndexFile) {
          if (endpointFolderIndexFile && !canonicalFolderIndex(node))
            context.report({
              node,
              message:
                "Endpoint index.ts must export only { run } from './procedure.ts' and type { Input } from './input.ts' and type { Output } from './output.ts'."
            });

          return;
        }

        if (folderProcedureFile || schemaFile) {
          const allowed = schemaFile
            ? folderRole === 'input'
              ? new Set(['inputSchema', 'Input', 'inputValidator'])
              : new Set(['outputSchema', 'Output', 'outputValidator'])
            : new Set(['run']);
          const exported = new Set<string>();

          for (const statement of node.body) {
            if (statement.type !== 'ExportNamedDeclaration') continue;

            const declaration = statement.declaration;

            if (declaration?.type === 'VariableDeclaration') {
              for (const item of declaration.declarations)
                if (item.id.type === 'Identifier') exported.add(item.id.name);
            } else if (
              declaration?.type === 'TSTypeAliasDeclaration' ||
              declaration?.type === 'TSInterfaceDeclaration'
            )
              exported.add(declaration.id.name);

            for (const specifier of statement.specifiers)
              if (specifier.exportKind !== 'type')
                exported.add(
                  specifier.exported.type === 'Identifier'
                    ? specifier.exported.name
                    : specifier.exported.value
                );
          }

          for (const name of exported)
            if (!allowed.has(name))
              context.report({
                node,
                message: schemaFile
                  ? 'Input/output schema modules export only their schema, inferred type, and validator.'
                  : 'Procedure implementation modules export only run.'
              });

          for (const name of allowed)
            if (!exported.has(name))
              context.report({
                node,
                message: schemaFile
                  ? `Schema module must export ${name}.`
                  : 'Procedure implementation must export run.'
              });
        }

        if (schemaFile) return;

        if (!routerFile) return;

        for (const statement of node.body) {
          if (
            statement.type === 'ImportDeclaration' ||
            statement.type === 'TSTypeAliasDeclaration' ||
            statement.type === 'TSInterfaceDeclaration'
          )
            continue;

          if (statement.type === 'ExportNamedDeclaration' && statement.exportKind === 'type')
            continue;

          if (
            statement.type === 'ExportNamedDeclaration' &&
            statement.declaration?.type === 'VariableDeclaration' &&
            statement.declaration.kind === 'const' &&
            statement.declaration.declarations.every(
              (item) =>
                item.init?.type === 'CallExpression' && item.init.callee.type === 'Identifier'
            )
          )
            continue;

          context.report({ node: statement, message });
        }
      },
      ImportDeclaration(node) {
        if (schemaContractFile) {
          const source = node.source.value;
          const target = source.startsWith('#server/')
            ? resolve(
                filename.slice(
                  0,
                  filename.indexOf('/apps/server/src/') + '/apps/server/src/'.length
                ),
                source.slice('#server/'.length)
              )
            : source.startsWith('.')
              ? resolve(dirname(filename), source)
              : '';
          const targetPath = target.replaceAll('\\', '/');

          if (
            source === '@study/db' ||
            source.startsWith('@study/db/') ||
            source === 'drizzle-orm' ||
            source.startsWith('drizzle-orm/') ||
            source.startsWith('#server/procedures/') ||
            targetPath.includes('/procedures/')
          )
            context.report({
              node,
              message:
                'Input and output schemas must not depend on database or procedure implementation modules.'
            });

          if (node.importKind !== 'type' && ['effect', 'effect/Schema'].includes(source))
            for (const specifier of node.specifiers)
              if (
                specifier.type === 'ImportSpecifier' &&
                specifier.importKind !== 'type' &&
                specifier.imported.type === 'Identifier' &&
                ['Any', 'Unknown'].includes(specifier.imported.name)
              )
                context.report({
                  node: specifier,
                  message:
                    'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
                });

          if (node.importKind !== 'type' && ['effect', 'effect/Schema'].includes(source))
            for (const specifier of node.specifiers)
              if (
                specifier.type === 'ImportSpecifier' &&
                specifier.importKind !== 'type' &&
                specifier.imported.type === 'Identifier' &&
                specifier.imported.name === 'optionalKey'
              )
                context.report({
                  node: specifier,
                  message:
                    'Use Schema.optional for Zod optional fields; Schema.optionalKey rejects explicit undefined.'
                });
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            specifier.imported.type === 'Identifier' &&
            (specifier.imported.name === 'run' || specifier.imported.name.endsWith('Router')) &&
            procedureSource(node.source.value, specifier.imported.name)
          )
            imports.set(specifier.local.name, specifier);
        }

        if (node.source.value === '@trpc/server') {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier')
              trpcNamespaces.set(specifier.local.name, specifier);

            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === 'initTRPC'
            )
              context.report({
                node: specifier,
                message: 'Create the tRPC builder only in runtime/trpc.ts.'
              });
          }
        }

        if (
          node.source.value === '#server/runtime/trpc' ||
          (filename.endsWith('/runtime/router.ts') && node.source.value === './trpc.ts')
        ) {
          for (const specifier of node.specifiers) {
            if (specifier.type !== 'ImportSpecifier') {
              context.report({ node: specifier, message });
              continue;
            }

            if (specifier.imported.type !== 'Identifier') continue;

            if (specifier.imported.name === 'publicProcedure')
              publicNames.set(specifier.local.name, specifier);

            if (specifier.imported.name === 'router')
              routerNames.set(specifier.local.name, specifier);
          }
        }

        if (node.source.value === './input.ts')
          for (const specifier of node.specifiers)
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === 'inputValidator'
            )
              inputValidators.set(specifier.local.name, specifier);

        if (node.source.value === './output.ts')
          for (const specifier of node.specifiers)
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === 'outputValidator'
            )
              outputValidators.set(specifier.local.name, specifier);

        if (node.source.value === 'effect')
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === 'Schema'
            )
              effectSchemas.set(specifier.local.name, specifier);

            if (specifier.type === 'ImportNamespaceSpecifier')
              effectNamespaces.set(specifier.local.name, specifier);
          }

        if (node.source.value === 'effect/Schema')
          for (const specifier of node.specifiers)
            if (specifier.type === 'ImportNamespaceSpecifier')
              effectSchemas.set(specifier.local.name, specifier);
      },
      Identifier(node) {
        if (
          schemaContractFile &&
          node.name === 'unknown' &&
          node.parent?.type !== 'MemberExpression' &&
          node.parent?.type !== 'Property'
        )
          context.report({
            node,
            message: 'Input/output schema modules must not use unknown placeholders.'
          });

        if (
          procedures &&
          bound(node, publicNames) &&
          node.parent?.type !== 'ImportSpecifier' &&
          !(node.parent?.type === 'MemberExpression' && node.parent.object === node)
        )
          context.report({ node, message });
      },
      VariableDeclarator(node) {
        if (
          schemaContractFile &&
          forbiddenSchemaPattern(node.id) &&
          effectSchemaNamespace(node.init)
        )
          reportForbiddenSchemaPattern(node.id);

        if (
          node.id.type === 'ObjectPattern' &&
          node.init?.type === 'Identifier' &&
          bound(node.init, trpcNamespaces)
        )
          context.report({ node, message: 'Create the tRPC builder only in runtime/trpc.ts.' });
      },
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          bound(node.object, trpcNamespaces) &&
          (member(node, 'initTRPC') ||
            (node.computed &&
              node.property.type === 'Literal' &&
              node.property.value === 'initTRPC'))
        )
          context.report({ node, message: 'Create the tRPC builder only in runtime/trpc.ts.' });

        if (procedures && node.object.type === 'Identifier' && bound(node.object, publicNames)) {
          if (folderProcedureFile) {
            const inputCall = node.parent;
            const outputMember = inputCall?.parent;
            const outputCall = outputMember?.parent;
            const queryMember = outputCall?.parent;
            const endpointCall = queryMember?.parent;
            const variable = endpointCall?.parent;

            if (
              member(node, 'input') &&
              inputCall?.type === 'CallExpression' &&
              outputMember?.type === 'MemberExpression' &&
              outputCall?.type === 'CallExpression' &&
              queryMember?.type === 'MemberExpression' &&
              endpointCall?.type === 'CallExpression' &&
              folderCanonical(endpointCall) &&
              variable?.type === 'VariableDeclarator' &&
              variable.id.type === 'Identifier' &&
              variable.id.name === 'run' &&
              variable.parent?.type === 'VariableDeclaration' &&
              variable.parent.kind === 'const' &&
              variable.parent.parent?.type === 'ExportNamedDeclaration'
            )
              return;

            context.report({ node, message });

            return;
          }

          const input = node.parent;
          const endpoint = input?.parent;
          const declaration = endpoint?.parent;

          if (
            !(
              member(node, 'input') &&
              input?.type === 'CallExpression' &&
              endpoint?.type === 'MemberExpression' &&
              endpoint.parent?.type === 'CallExpression' &&
              canonical(endpoint.parent) &&
              declaration?.type === 'CallExpression' &&
              declaration.parent?.type === 'VariableDeclarator' &&
              declaration.parent.id.type === 'Identifier' &&
              declaration.parent.id.name === 'run' &&
              declaration.parent.parent?.type === 'VariableDeclaration' &&
              declaration.parent.parent.kind === 'const' &&
              declaration.parent.parent.parent?.type === 'ExportNamedDeclaration'
            )
          ) {
            context.report({ node, message });
          }
        }

        if (schemaContractFile && effectSchemaNamespace(node.object)) {
          const property = node.computed
            ? node.property.type === 'Literal'
              ? node.property.value
              : undefined
            : node.property.name;

          if (property === 'Any' || property === 'Unknown')
            context.report({
              node,
              message:
                'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
            });

          if (property === 'optionalKey')
            context.report({
              node,
              message:
                'Use Schema.optional for Zod optional fields; Schema.optionalKey rejects explicit undefined.'
            });
        }

        const property = node.computed
          ? node.property.type === 'Literal' && typeof node.property.value === 'string'
            ? node.property.value
            : undefined
          : node.property.name;

        if (
          schemaContractFile &&
          property !== undefined &&
          ['$inferSelect', '$inferInsert'].includes(property)
        )
          context.report({
            node,
            message:
              'Input/output schemas must not derive API types from Drizzle inferred row types.'
          });
      },
      AssignmentExpression(node) {
        if (
          schemaContractFile &&
          forbiddenSchemaPattern(node.left) &&
          effectSchemaNamespace(node.right)
        )
          reportForbiddenSchemaPattern(node.left);
      },
      TSAnyKeyword(node) {
        if (schemaContractFile)
          context.report({
            node,
            message: 'Input/output schema modules must not use any placeholders.'
          });
      },
      TSUnknownKeyword(node) {
        if (schemaContractFile)
          context.report({
            node,
            message: 'Input/output schema modules must not use unknown placeholders.'
          });
      },
      ExportNamedDeclaration(node) {
        if (
          schemaContractFile &&
          node.source &&
          ['effect', 'effect/Schema'].includes(node.source.value) &&
          node.exportKind !== 'type'
        )
          for (const specifier of node.specifiers)
            if (
              specifier.exportKind !== 'type' &&
              specifier.local.type === 'Identifier' &&
              ['Any', 'Unknown', 'optionalKey'].includes(specifier.local.name)
            )
              context.report({
                node: specifier,
                message: ['Any', 'Unknown'].includes(specifier.local.name)
                  ? 'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
                  : 'Use Schema.optional for Zod optional fields; Schema.optionalKey rejects explicit undefined.'
              });

        if (folderIndexFile) return;

        if ((!procedures && !routerFile) || node.exportKind === 'type') return;

        if (routerFile && node.declaration?.type === 'VariableDeclaration') {
          for (const item of node.declaration.declarations) {
            if (
              item.init?.type !== 'CallExpression' ||
              item.init.callee.type !== 'Identifier' ||
              !bound(item.init.callee, routerNames)
            )
              context.report({ node: item, message });
          }
        }

        const declaration = node.declaration;

        if (declaration?.type === 'VariableDeclaration') {
          for (const item of declaration.declarations) {
            if (
              item.id.type === 'Identifier' &&
              item.id.name === 'run' &&
              (declaration.kind !== 'const' ||
                !(folderProcedureFile ? folderCanonical(item.init) : canonical(item.init)))
            )
              context.report({ node: item, message });
          }
        } else if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === 'run')
          context.report({ node, message });

        for (const specifier of node.specifiers)
          if (
            specifier.exportKind !== 'type' &&
            ((specifier.local.type === 'Identifier' && specifier.local.name === 'run') ||
              (specifier.exported.type === 'Identifier'
                ? specifier.exported.name
                : specifier.exported.value) === 'run')
          )
            context.report({ node, message });
      },
      ExportAllDeclaration(node) {
        if (procedures && node.exportKind !== 'type')
          context.report({
            node,
            message:
              'Procedure modules must not re-export values with export *; export helpers explicitly.'
          });
      },
      ExportDefaultDeclaration(node) {
        if (procedures) context.report({ node, message });
      },
      CallExpression(node) {
        if (
          (!procedures && !routerFile) ||
          node.callee.type !== 'Identifier' ||
          !bound(node.callee, routerNames)
        )
          return;

        const object = node.arguments[0];

        if (
          node.arguments.length !== 1 ||
          object?.type !== 'ObjectExpression' ||
          object.properties.some(
            (property) =>
              property.type !== 'Property' ||
              property.computed ||
              property.kind !== 'init' ||
              property.method ||
              property.value.type !== 'Identifier' ||
              !bound(property.value, imports)
          )
        )
          context.report({ node, message });
      }
    };
  }
});
