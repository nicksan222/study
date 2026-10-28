import { defineRule } from 'vite-plus/lint/plugins';

const replacements: Record<string, Record<string, string>> = {
  Effect: {
    catchAll: 'use Effect.catch',
    catchAllCause: 'use Effect.catchCause',
    catchAllDefect: 'use Effect.catchDefect',
    catchSome: 'use Effect.catchFilter with a Filter'
  },
  Context: {
    Tag: 'use Context.Service',
    GenericTag: 'use Context.Service'
  }
};

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const modules = new Map<string, { module: string; specifier: any }>();

    function message(module: string, name: string): string | undefined {
      const entries = replacements[module];
      const replacement = entries && Object.hasOwn(entries, name) ? entries[name] : undefined;

      return replacement
        ? `${module}.${name} was removed in Effect v4; ${replacement}.`
        : undefined;
    }

    function bound(node: any, specifier: any): boolean {
      let scope = context.sourceCode.getScope(node);

      while (scope) {
        const variable = scope.set.get(node.name);

        if (variable) return variable.defs.some((definition) => definition.node === specifier);

        scope = scope.upper!;
      }

      return false;
    }

    function propertyName(property: any, computed: boolean): string | null {
      if (!computed && property.type === 'Identifier') return property.name;

      return property.type === 'Literal' && typeof property.value === 'string'
        ? property.value
        : null;
    }

    function moduleFor(node: any): string | null {
      if (node?.type === 'Identifier') {
        const binding = modules.get(node.name);

        return binding && bound(node, binding.specifier) ? binding.module : null;
      }

      if (node?.type === 'MemberExpression' && moduleFor(node.object) === 'root') {
        const name = propertyName(node.property, node.computed);

        return name === 'Effect' || name === 'Context' ? name : null;
      }

      return null;
    }

    function reportPattern(pattern: any, module: string): void {
      for (const property of pattern.properties) {
        if (property.type !== 'Property') continue;

        const name = propertyName(property.key, property.computed);

        if (!name) continue;

        if (module === 'root' && (name === 'Effect' || name === 'Context')) {
          if (property.value.type === 'ObjectPattern') reportPattern(property.value, name);
        } else {
          const diagnostic = message(module, name);

          if (diagnostic) context.report({ node: property, message: diagnostic });
        }
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return;

        const source = node.source.value;
        const submodule =
          source === 'effect/Effect' ? 'Effect' : source === 'effect/Context' ? 'Context' : null;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type') continue;

          if (source === 'effect' && specifier.type === 'ImportNamespaceSpecifier') {
            modules.set(specifier.local.name, { module: 'root', specifier });
          } else if (source === 'effect' && specifier.type === 'ImportSpecifier') {
            const name =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value;

            if (name === 'Effect' || name === 'Context')
              modules.set(specifier.local.name, { module: name, specifier });
          } else if (submodule && specifier.type === 'ImportNamespaceSpecifier') {
            modules.set(specifier.local.name, { module: submodule, specifier });
          } else if (submodule && specifier.type === 'ImportSpecifier') {
            const name =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value;
            const diagnostic = message(submodule, name);

            if (diagnostic) context.report({ node: specifier, message: diagnostic });
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source || node.exportKind === 'type') return;

        const module =
          node.source.value === 'effect/Effect'
            ? 'Effect'
            : node.source.value === 'effect/Context'
              ? 'Context'
              : null;

        if (!module) return;

        for (const specifier of node.specifiers) {
          if (specifier.exportKind === 'type') continue;

          const name = propertyName(specifier.local, false);
          const diagnostic = name && message(module, name);

          if (diagnostic) context.report({ node: specifier, message: diagnostic });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern') return;

        const module = moduleFor(node.init);

        if (module) reportPattern(node.id, module);
      },
      AssignmentExpression(node) {
        if (node.operator !== '=' || node.left.type !== 'ObjectPattern') return;

        const module = moduleFor(node.right);

        if (module) reportPattern(node.left, module);
      },
      MemberExpression(node) {
        const module = moduleFor(node.object);
        const name = propertyName(node.property, node.computed);
        const diagnostic = module && name && message(module, name);

        if (diagnostic) context.report({ node, message: diagnostic });
      }
    };
  }
});
