import { resolveValue } from './module-factories.ts';
import { binding, imported, property, typedOwner } from './synchronous-transactions.ts';

const names: Record<string, string> = {
  workflowEvents: 'workflow_events',
  workflowReceipts: 'workflow_receipts'
};

export function persistenceWriters(context: any, report: (node: any, table: string) => void) {
  const source = (def: any, sql = false) =>
    def?.parent?.type === 'ImportDeclaration' &&
    def.parent.importKind !== 'type' &&
    def.importKind !== 'type' &&
    (sql ? /^(?:@study\/db(?:\/schema)?|drizzle-orm(?:\/.*)?)$/ : /^@study\/db(?:\/schema)?$/).test(
      def.parent.source.value
    );

  function importedName(node: any, sql = false, seen = new Set<any>()): string | undefined {
    if (!node || seen.has(node)) return;

    seen.add(node);

    if (
      [
        'TSAsExpression',
        'TSSatisfiesExpression',
        'TSNonNullExpression',
        'ParenthesizedExpression',
        'TSTypeAssertion'
      ].includes(node.type)
    )
      return importedName(node.expression, sql, seen);

    if (node.type === 'MemberExpression') {
      const object = resolveValue(context, node.object);
      const def = binding(context, object)?.defs[0]?.node;

      return def?.type === 'ImportNamespaceSpecifier' && source(def, sql)
        ? property(node)
        : undefined;
    }

    if (node.type !== 'Identifier') return;

    const def = binding(context, node)?.defs[0]?.node;

    if (def?.type === 'ImportSpecifier' && source(def, sql))
      return def.imported.name ?? def.imported.value;

    if (def?.type !== 'VariableDeclarator' || def.parent?.kind !== 'const') return;

    if (def.id.type === 'ObjectPattern') {
      const prop = def.id.properties.find(
        (p: any) => p.type === 'Property' && (p.value.name ?? p.value.left?.name) === node.name
      );
      const object = resolveValue(context, def.init);
      const namespace = binding(context, object)?.defs[0]?.node;

      if (prop && namespace?.type === 'ImportNamespaceSpecifier' && source(namespace, sql))
        return prop.computed ? prop.key.value : (prop.key.name ?? prop.key.value);

      return;
    }

    return importedName(def.init, sql, seen);
  }

  const tableName = (node: any) => {
    const name = importedName(node);

    return name ? (names[name] ?? name) : undefined;
  };
  const isSql = (node: any) => importedName(node, true) === 'sql';

  function databaseReceiver(node: any, seen = new Set<any>()): boolean {
    if (!node || seen.has(node)) return false;

    seen.add(node);

    if (typedOwner(context, node)) return true;

    if (node.type === 'MemberExpression') return databaseReceiver(node.object, seen);

    if (node.type === 'CallExpression' && property(node.callee) === 'prepare')
      return databaseReceiver(node.callee.object, seen);

    const def = binding(context, node)?.defs[0]?.node;
    const annotation =
      def?.type === 'VariableDeclarator'
        ? def.id.typeAnnotation?.typeAnnotation
        : binding(context, node)?.defs[0]?.name?.typeAnnotation?.typeAnnotation;

    if (
      annotation?.type === 'TSTypeReference' &&
      imported(context, annotation.typeName, /(?:^@study\/db$|platform\/database\/context$)/)
    )
      return true;

    return def?.type === 'VariableDeclarator' && def.parent?.kind === 'const'
      ? databaseReceiver(def.init, seen)
      : false;
  }

  function sqlWrites(node: any, text: string, expressions: any[] = []) {
    // Keep string values opaque, but retain quoted identifiers and interpolation positions.
    const re =
      /(--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|("(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]]|\]\])*\])|(__INTERPOLATION_\d+__|[a-zA-Z_][\w$]*|[(),.;])/g;
    const tokens: string[] = [];

    for (const match of text.matchAll(re)) {
      if (match[1]) continue;

      if (match[2]) tokens.push('__STRING__');
      else if (match[3])
        tokens.push(
          '@' +
            match[3]
              .slice(1, -1)
              .replaceAll(
                match[3][0] === '[' ? ']]' : match[3][0].repeat(2),
                match[3][0] === '[' ? ']' : match[3][0]
              )
              .toLowerCase()
        );
      else tokens.push(match[4].toLowerCase());
    }

    let depth = 0;
    let statement = false;

    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i];

      if (word === '(') {
        depth++;
        continue;
      }

      if (word === ')') {
        depth--;
        continue;
      }

      if (word === ';' && depth === 0) {
        statement = false;
        continue;
      }

      if (depth || statement) continue;

      if (word === 'with' || word === 'recursive') continue;

      // A statement's first top-level operation owns its target. SELECT columns,
      // CTE names and UPSERT assignments cannot start another mutation.
      if (!['select', 'insert', 'replace', 'update', 'delete'].includes(word)) continue;

      if (tokens[i + 1] === 'as' || tokens[i + 1] === ',' || tokens[i + 1] === '(') continue;

      statement = true;
      let at = i + 1;

      if (word === 'insert' || word === 'replace') {
        if (tokens[at] === 'or') at += 2;

        if (tokens[at++] !== 'into') continue;
      } else if (word === 'update') {
        if (tokens[at] === 'or') at += 2;
      } else if (word === 'delete') {
        if (tokens[at++] !== 'from') continue;
      } else continue;

      if (tokens[at + 1] === '.') at += 2;

      const token = tokens[at]?.replace(/^@/, '');
      const interpolation = /^__interpolation_(\d+)__$/.exec(token ?? '');
      const table = interpolation ? tableName(expressions[Number(interpolation[1])]) : token;

      if (table) report(node, table);
    }
  }

  function inspectLiteral(node: any, value: any) {
    const resolved = resolveValue(context, value);

    if (resolved?.type === 'Literal' && typeof resolved.value === 'string')
      sqlWrites(node, resolved.value);
    else if (resolved?.type === 'TemplateLiteral' && resolved.expressions.length === 0)
      sqlWrites(node, resolved.quasis[0].value.cooked);
  }

  return {
    CallExpression(node: any) {
      const method = property(node.callee);

      if (
        ['insert', 'update', 'delete'].includes(method ?? '') &&
        databaseReceiver(node.callee.object)
      ) {
        const table = tableName(node.arguments[0]);

        if (table) report(node, table);
      }

      if (
        (method === 'raw' && isSql(node.callee.object)) ||
        (['exec', 'execute', 'prepare', 'run', 'all', 'get'].includes(method ?? '') &&
          databaseReceiver(node.callee.object))
      )
        inspectLiteral(node, node.arguments[0]);
    },
    TaggedTemplateExpression(node: any) {
      if (!isSql(node.tag)) return;

      const text = node.quasi.quasis
        .map(
          (part: any, i: number) =>
            (part.value.cooked ?? part.value.raw) +
            (i < node.quasi.expressions.length ? ` __INTERPOLATION_${i}__ ` : '')
        )
        .join('');

      sqlWrites(node, text, node.quasi.expressions);
    }
  };
}
